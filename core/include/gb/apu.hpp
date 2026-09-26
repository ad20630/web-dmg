#pragma once

#include <array>
#include <cstdint>
#include <vector>

#include "gb/save_state.hpp"

namespace gb {

// Generates stereo audio by emulating the DMG's 4 sound channels (2 pulse,
// 1 wave, 1 noise) sample-accurately at the T-cycle level, then downsamples
// the mix to the output rate set via setSampleRate() (callers should pass
// the playback device's actual native rate -- see setSampleRate() -- so no
// further resampling is needed downstream). Registers live at 0xFF10-0xFF26
// (control) and 0xFF30-0xFF3F (wave RAM).
class Apu {
public:
    static constexpr int kClockRate = 4194304;
    static constexpr int kDefaultSampleRate = 44100;

    Apu();
    ~Apu();

    void reset();
    void tick(int tCycles);

    // Sets the output sample rate used to downsample the emulated 4.19 MHz
    // signal. Callers should pass their playback device's actual native
    // rate (e.g. an AudioContext's sampleRate) rather than a fixed value,
    // so the generated audio never needs to be resampled again before
    // playback -- resampling independently-generated chunks (as opposed to
    // one continuous stream) is a common source of audible chunk-boundary
    // artifacts. Not part of game state: unaffected by reset()/loadState().
    void setSampleRate(int sampleRate) { sampleRate_ = sampleRate > 0 ? sampleRate : kDefaultSampleRate; }

    uint8_t read8(uint16_t address) const;  // 0xFF10-0xFF26, 0xFF30-0xFF3F
    void write8(uint16_t address, uint8_t value);

    void saveState(StateWriter& writer) const;
    void loadState(StateReader& reader);

    // Interleaved stereo float32 samples (L, R, L, R, ...) in [-1, 1]
    // accumulated since the last clearSampleBuffer() call. The reference
    // aliases internal storage; callers should copy it out before ticking
    // the APU further (the next sample may reallocate the backing storage).
    const std::vector<float>& sampleBuffer() const { return sampleBuffer_; }
    void clearSampleBuffer() { sampleBuffer_.clear(); }

private:
    // Pulse channels (1 and 2). Channel 1 additionally has frequency sweep;
    // channel 2 leaves the sweep fields unused.
    struct PulseChannel {
        // Register-backed state.
        uint8_t duty = 0;                 // NRx1 bits 7-6
        uint8_t envelopeInitialVolume = 0; // NRx2 bits 7-4
        bool envelopeIncrease = false;     // NRx2 bit 3
        uint8_t envelopePeriod = 0;        // NRx2 bits 2-0
        uint16_t frequency = 0;            // 11-bit, NRx3 + NRx4 bits 2-0
        bool lengthEnabled = false;        // NRx4 bit 6
        uint8_t sweepPeriod = 0;           // NR10 bits 6-4 (channel 1 only)
        bool sweepNegate = false;          // NR10 bit 3
        uint8_t sweepShift = 0;            // NR10 bits 2-0

        // Runtime state.
        bool enabled = false;
        bool dacEnabled = false;
        int lengthCounter = 0;
        int frequencyTimer = 0;
        uint8_t dutyPos = 0;
        uint8_t volume = 0;
        int envelopeTimer = 0;
        uint16_t shadowFrequency = 0;
        int sweepTimer = 0;
        bool sweepEnabled = false;

        void trigger(bool hasSweep);
        void stepFrequency();
        void stepLength();
        void stepEnvelope();
        void stepSweep();
        uint16_t calculateSweepFrequency() const;
        uint8_t digitalOutput() const;
        // DAC output centred on this channel's own midpoint (half its current
        // volume) rather than on a fixed level, scaled to [-1, 1]. See
        // Apu::accumulateMix() for why.
        float centeredOutput() const;

        void saveState(StateWriter& writer) const;
        void loadState(StateReader& reader);
    };

    struct WaveChannel {
        bool dacPower = false;    // NR30 bit 7
        uint8_t volumeCode = 0;   // NR32 bits 6-5
        uint16_t frequency = 0;   // 11-bit
        bool lengthEnabled = false;
        std::array<uint8_t, 16> waveRam{};

        bool enabled = false;
        int lengthCounter = 0;
        int frequencyTimer = 0;
        uint8_t wavePos = 0;

        // Mean of digitalOutput() over one full waveform cycle at the current
        // volume, cached because it is read every T-cycle. Invalidated
        // (dcValid = false) whenever wave RAM or the volume code changes.
        mutable float waveMean = 0.0f;
        mutable bool waveMeanValid = false;

        void trigger();
        void stepFrequency();
        void stepLength();
        uint8_t digitalOutput() const;
        // DAC output centred on this channel's own midpoint (half its current
        // volume) rather than on a fixed level, scaled to [-1, 1]. See
        // Apu::accumulateMix() for why.
        float centeredOutput() const;

        void saveState(StateWriter& writer) const;
        void loadState(StateReader& reader);
    };

    struct NoiseChannel {
        uint8_t envelopeInitialVolume = 0;
        bool envelopeIncrease = false;
        uint8_t envelopePeriod = 0;
        uint8_t clockShift = 0;   // NR43 bits 7-4
        bool widthMode7Bit = false; // NR43 bit 3
        uint8_t divisorCode = 0;  // NR43 bits 2-0
        bool lengthEnabled = false;

        bool enabled = false;
        bool dacEnabled = false;
        int lengthCounter = 0;
        int frequencyTimer = 0;
        uint8_t volume = 0;
        int envelopeTimer = 0;
        uint16_t lfsr = 0x7FFF;

        void trigger();
        void stepFrequency();
        void stepLength();
        void stepEnvelope();
        int reloadDivisor() const;
        uint8_t digitalOutput() const;
        // DAC output centred on this channel's own midpoint (half its current
        // volume) rather than on a fixed level, scaled to [-1, 1]. See
        // Apu::accumulateMix() for why.
        float centeredOutput() const;

        void saveState(StateWriter& writer) const;
        void loadState(StateReader& reader);
    };

    PulseChannel channel1_;
    PulseChannel channel2_;
    WaveChannel channel3_;
    NoiseChannel channel4_;

    bool powerOn_ = false;
    uint8_t nr50_ = 0; // master volume / VIN panning
    uint8_t nr51_ = 0; // channel panning

    int sampleRate_ = kDefaultSampleRate;

    int frameSequencerCounter_ = 0;
    uint8_t frameSequencerStep_ = 0;
    int sampleCycleAccumulator_ = 0;

    // Running sum of every T-cycle's instantaneous mix since the last
    // emitted sample, plus how many cycles went into it. Averaging these
    // (a box filter) before downsampling is what keeps the channels'
    // high-frequency content -- square edges, and especially the noise
    // channel's LFSR, which can toggle in the hundreds of kHz -- from
    // aliasing into audible high-pitched noise. Point-sampling instead of
    // averaging is the single biggest source of that artifact.
    float mixAccumLeft_ = 0.0f;
    float mixAccumRight_ = 0.0f;
    int mixAccumCount_ = 0;

    // One-pole low-pass applied to each downsampled output sample. Real DMG
    // hardware's analog output stage rolls off the sharp edges of its square
    // waves; without this, the same (correctly band-limited, alias-free)
    // signal reproduces all of that edge energy up to ~22 kHz and reads as
    // a harsh/shrill hiss riding on top of the actual notes.
    float lowpassLeft_ = 0.0f;
    float lowpassRight_ = 0.0f;

    // DC-blocking one-pole high-pass applied after the low-pass above. Real
    // DMG hardware's output path is AC-coupled, so a channel parked at an
    // inaudibly high frequency (a common "silence without touching NR52"
    // trick games use) decays to true silence almost instantly there; our
    // model has no equivalent stage, so without this the same trick leaves
    // a large (order of magnitude: tens of percent of full scale), sustained
    // DC bias in the output for as long as the channel stays parked there -
    // inaudible as a *tone* since it's unchanging, but audible as a hum once
    // real playback hardware's own AC coupling reacts to a sustained
    // near-full-scale offset.
    float dcBlockPrevInLeft_ = 0.0f;
    float dcBlockPrevOutLeft_ = 0.0f;
    float dcBlockPrevInRight_ = 0.0f;
    float dcBlockPrevOutRight_ = 0.0f;

    std::vector<float> sampleBuffer_;

    void accumulateMix();
    void stepFrameSequencer();
    void emitSample();
    void powerOff();
};

} // namespace gb
