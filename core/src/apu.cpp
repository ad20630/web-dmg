#include "gb/apu.hpp"

namespace gb {

namespace {

constexpr uint16_t kNr10 = 0xFF10;
constexpr uint16_t kNr11 = 0xFF11;
constexpr uint16_t kNr12 = 0xFF12;
constexpr uint16_t kNr13 = 0xFF13;
constexpr uint16_t kNr14 = 0xFF14;
constexpr uint16_t kNr21 = 0xFF16;
constexpr uint16_t kNr22 = 0xFF17;
constexpr uint16_t kNr23 = 0xFF18;
constexpr uint16_t kNr24 = 0xFF19;
constexpr uint16_t kNr30 = 0xFF1A;
constexpr uint16_t kNr31 = 0xFF1B;
constexpr uint16_t kNr32 = 0xFF1C;
constexpr uint16_t kNr33 = 0xFF1D;
constexpr uint16_t kNr34 = 0xFF1E;
constexpr uint16_t kNr41 = 0xFF20;
constexpr uint16_t kNr42 = 0xFF21;
constexpr uint16_t kNr43 = 0xFF22;
constexpr uint16_t kNr44 = 0xFF23;
constexpr uint16_t kNr50 = 0xFF24;
constexpr uint16_t kNr51 = 0xFF25;
constexpr uint16_t kNr52 = 0xFF26;
constexpr uint16_t kWaveRamStart = 0xFF30;
constexpr uint16_t kWaveRamEnd = 0xFF3F;

// Row 0 = 12.5% duty ... row 3 = 75% duty, read left (step 0) to right (step 7).
constexpr uint8_t kDutyTable[4][8] = {
    {0, 0, 0, 0, 0, 0, 0, 1},
    {1, 0, 0, 0, 0, 0, 0, 1},
    {1, 0, 0, 0, 0, 1, 1, 1},
    {0, 1, 1, 1, 1, 1, 1, 0},
};

constexpr uint8_t kNoiseDivisorTable[8] = {8, 16, 32, 48, 64, 80, 96, 112};

constexpr int kFrameSequencerPeriod = 8192; // T-cycles between 512 Hz steps

// Cutoff for the post-mix low-pass filter (see Apu::lowpassLeft_/lowpassRight_).
constexpr float kLowPassCutoffHz = 14000.0f;

// Cutoff for the DC-blocking high-pass filter (see Apu::dcBlockPrev*_). Well
// below the audible range (~20 Hz is the usual low end of human hearing) so
// it only removes sustained bias, not bass content.
constexpr float kDcBlockCutoffHz = 20.0f;

float onePoleAlpha(int sampleRate, float cutoffHz) {
    const float dt = 1.0f / static_cast<float>(sampleRate);
    const float rc = 1.0f / (2.0f * 3.14159265f * cutoffHz);
    return dt / (rc + dt);
}

} // namespace

// ---- PulseChannel -----------------------------------------------------

void Apu::PulseChannel::trigger(bool hasSweep) {
    enabled = dacEnabled;
    if (lengthCounter == 0) lengthCounter = 64;
    frequencyTimer = (2048 - frequency) * 4;
    envelopeTimer = envelopePeriod == 0 ? 8 : envelopePeriod;
    volume = envelopeInitialVolume;

    if (hasSweep) {
        shadowFrequency = frequency;
        sweepTimer = sweepPeriod == 0 ? 8 : sweepPeriod;
        sweepEnabled = sweepPeriod != 0 || sweepShift != 0;
        if (sweepShift != 0 && calculateSweepFrequency() > 2047) {
            enabled = false;
        }
    }
}

void Apu::PulseChannel::stepFrequency() {
    if (--frequencyTimer <= 0) {
        frequencyTimer += (2048 - frequency) * 4;
        dutyPos = (dutyPos + 1) & 0x07;
    }
}

void Apu::PulseChannel::stepLength() {
    if (lengthEnabled && lengthCounter > 0) {
        --lengthCounter;
        if (lengthCounter == 0) enabled = false;
    }
}

void Apu::PulseChannel::stepEnvelope() {
    if (envelopePeriod == 0) return;
    if (envelopeTimer > 0) --envelopeTimer;
    if (envelopeTimer == 0) {
        envelopeTimer = envelopePeriod;
        if (envelopeIncrease && volume < 15) {
            ++volume;
        } else if (!envelopeIncrease && volume > 0) {
            --volume;
        }
    }
}

uint16_t Apu::PulseChannel::calculateSweepFrequency() const {
    const int delta = shadowFrequency >> sweepShift;
    const int newFrequency = sweepNegate ? shadowFrequency - delta : shadowFrequency + delta;
    return newFrequency < 0 ? 0 : static_cast<uint16_t>(newFrequency);
}

void Apu::PulseChannel::stepSweep() {
    if (sweepTimer > 0) --sweepTimer;
    if (sweepTimer != 0) return;
    sweepTimer = sweepPeriod == 0 ? 8 : sweepPeriod;

    if (!sweepEnabled || sweepPeriod == 0) return;

    const uint16_t newFrequency = calculateSweepFrequency();
    if (newFrequency > 2047) {
        enabled = false;
        return;
    }
    if (sweepShift != 0) {
        frequency = newFrequency;
        shadowFrequency = newFrequency;
        if (calculateSweepFrequency() > 2047) {
            enabled = false;
        }
    }
}

uint8_t Apu::PulseChannel::digitalOutput() const {
    if (!enabled || !dacEnabled) return 0;
    return kDutyTable[duty][dutyPos] * volume;
}

float Apu::PulseChannel::centeredOutput() const {
    return (static_cast<float>(digitalOutput()) - volume * 0.5f) / 7.5f;
}

void Apu::PulseChannel::saveState(StateWriter& writer) const {
    writer.writeU8(duty);
    writer.writeU8(envelopeInitialVolume);
    writer.writeBool(envelopeIncrease);
    writer.writeU8(envelopePeriod);
    writer.writeU16(frequency);
    writer.writeBool(lengthEnabled);
    writer.writeU8(sweepPeriod);
    writer.writeBool(sweepNegate);
    writer.writeU8(sweepShift);

    writer.writeBool(enabled);
    writer.writeBool(dacEnabled);
    writer.writeU32(static_cast<uint32_t>(lengthCounter));
    writer.writeU32(static_cast<uint32_t>(frequencyTimer));
    writer.writeU8(dutyPos);
    writer.writeU8(volume);
    writer.writeU32(static_cast<uint32_t>(envelopeTimer));
    writer.writeU16(shadowFrequency);
    writer.writeU32(static_cast<uint32_t>(sweepTimer));
    writer.writeBool(sweepEnabled);
}

void Apu::PulseChannel::loadState(StateReader& reader) {
    duty = reader.readU8();
    envelopeInitialVolume = reader.readU8();
    envelopeIncrease = reader.readBool();
    envelopePeriod = reader.readU8();
    frequency = reader.readU16();
    lengthEnabled = reader.readBool();
    sweepPeriod = reader.readU8();
    sweepNegate = reader.readBool();
    sweepShift = reader.readU8();

    enabled = reader.readBool();
    dacEnabled = reader.readBool();
    lengthCounter = static_cast<int>(reader.readU32());
    frequencyTimer = static_cast<int>(reader.readU32());
    dutyPos = reader.readU8();
    volume = reader.readU8();
    envelopeTimer = static_cast<int>(reader.readU32());
    shadowFrequency = reader.readU16();
    sweepTimer = static_cast<int>(reader.readU32());
    sweepEnabled = reader.readBool();
}

// ---- WaveChannel --------------------------------------------------------

void Apu::WaveChannel::trigger() {
    enabled = dacPower;
    if (lengthCounter == 0) lengthCounter = 256;
    frequencyTimer = (2048 - frequency) * 2;
    wavePos = 0;
}

void Apu::WaveChannel::stepFrequency() {
    if (--frequencyTimer <= 0) {
        frequencyTimer += (2048 - frequency) * 2;
        wavePos = (wavePos + 1) & 0x1F;
    }
}

void Apu::WaveChannel::stepLength() {
    if (lengthEnabled && lengthCounter > 0) {
        --lengthCounter;
        if (lengthCounter == 0) enabled = false;
    }
}

uint8_t Apu::WaveChannel::digitalOutput() const {
    if (!enabled || !dacPower) return 0;
    const uint8_t byte = waveRam[wavePos >> 1];
    const uint8_t sample = (wavePos & 1) == 0 ? (byte >> 4) : (byte & 0x0F);
    switch (volumeCode & 0x03) {
        case 0: return 0;          // mute
        case 1: return sample;     // 100%
        case 2: return sample >> 1; // 50%
        default: return sample >> 2; // 25%
    }
}

float Apu::WaveChannel::centeredOutput() const {
    // Centre on the waveform's own mean rather than a fixed midpoint: wave RAM
    // is typically blank (all zero) at boot, and a fixed midpoint would put
    // such a channel at a constant -1 the moment it is triggered.
    if (!waveMeanValid) {
        const uint8_t shift = (volumeCode & 0x03) == 0 ? 4 : (volumeCode & 0x03) - 1;
        int sum = 0;
        for (const uint8_t byte : waveRam) {
            sum += (byte >> 4) >> shift;
            sum += (byte & 0x0F) >> shift;
        }
        waveMean = static_cast<float>(sum) / 32.0f;
        waveMeanValid = true;
    }
    return (static_cast<float>(digitalOutput()) - waveMean) / 7.5f;
}

void Apu::WaveChannel::saveState(StateWriter& writer) const {
    writer.writeBool(dacPower);
    writer.writeU8(volumeCode);
    writer.writeU16(frequency);
    writer.writeBool(lengthEnabled);
    writer.writeBytes(waveRam.data(), waveRam.size());

    writer.writeBool(enabled);
    writer.writeU32(static_cast<uint32_t>(lengthCounter));
    writer.writeU32(static_cast<uint32_t>(frequencyTimer));
    writer.writeU8(wavePos);
}

void Apu::WaveChannel::loadState(StateReader& reader) {
    dacPower = reader.readBool();
    volumeCode = reader.readU8();
    frequency = reader.readU16();
    lengthEnabled = reader.readBool();
    reader.readBytes(waveRam.data(), waveRam.size());
    waveMeanValid = false;

    enabled = reader.readBool();
    lengthCounter = static_cast<int>(reader.readU32());
    frequencyTimer = static_cast<int>(reader.readU32());
    wavePos = reader.readU8();
}

// ---- NoiseChannel ---------------------------------------------------------

int Apu::NoiseChannel::reloadDivisor() const {
    return kNoiseDivisorTable[divisorCode] << clockShift;
}

void Apu::NoiseChannel::trigger() {
    enabled = dacEnabled;
    if (lengthCounter == 0) lengthCounter = 64;
    frequencyTimer = reloadDivisor();
    envelopeTimer = envelopePeriod == 0 ? 8 : envelopePeriod;
    volume = envelopeInitialVolume;
    lfsr = 0x7FFF;
}

void Apu::NoiseChannel::stepFrequency() {
    if (--frequencyTimer <= 0) {
        frequencyTimer += reloadDivisor();
        const uint8_t xorBit = (lfsr & 0x01) ^ ((lfsr >> 1) & 0x01);
        lfsr >>= 1;
        lfsr |= static_cast<uint16_t>(xorBit) << 14;
        if (widthMode7Bit) {
            lfsr = static_cast<uint16_t>((lfsr & ~(1u << 6)) | (xorBit << 6));
        }
    }
}

void Apu::NoiseChannel::stepLength() {
    if (lengthEnabled && lengthCounter > 0) {
        --lengthCounter;
        if (lengthCounter == 0) enabled = false;
    }
}

void Apu::NoiseChannel::stepEnvelope() {
    if (envelopePeriod == 0) return;
    if (envelopeTimer > 0) --envelopeTimer;
    if (envelopeTimer == 0) {
        envelopeTimer = envelopePeriod;
        if (envelopeIncrease && volume < 15) {
            ++volume;
        } else if (!envelopeIncrease && volume > 0) {
            --volume;
        }
    }
}

uint8_t Apu::NoiseChannel::digitalOutput() const {
    if (!enabled || !dacEnabled) return 0;
    return (~lfsr & 0x01) * volume;
}

float Apu::NoiseChannel::centeredOutput() const {
    return (static_cast<float>(digitalOutput()) - volume * 0.5f) / 7.5f;
}

void Apu::NoiseChannel::saveState(StateWriter& writer) const {
    writer.writeU8(envelopeInitialVolume);
    writer.writeBool(envelopeIncrease);
    writer.writeU8(envelopePeriod);
    writer.writeU8(clockShift);
    writer.writeBool(widthMode7Bit);
    writer.writeU8(divisorCode);
    writer.writeBool(lengthEnabled);

    writer.writeBool(enabled);
    writer.writeBool(dacEnabled);
    writer.writeU32(static_cast<uint32_t>(lengthCounter));
    writer.writeU32(static_cast<uint32_t>(frequencyTimer));
    writer.writeU8(volume);
    writer.writeU32(static_cast<uint32_t>(envelopeTimer));
    writer.writeU16(lfsr);
}

void Apu::NoiseChannel::loadState(StateReader& reader) {
    envelopeInitialVolume = reader.readU8();
    envelopeIncrease = reader.readBool();
    envelopePeriod = reader.readU8();
    clockShift = reader.readU8();
    widthMode7Bit = reader.readBool();
    divisorCode = reader.readU8();
    lengthEnabled = reader.readBool();

    enabled = reader.readBool();
    dacEnabled = reader.readBool();
    lengthCounter = static_cast<int>(reader.readU32());
    frequencyTimer = static_cast<int>(reader.readU32());
    volume = reader.readU8();
    envelopeTimer = static_cast<int>(reader.readU32());
    lfsr = reader.readU16();
}

// ---- Apu ------------------------------------------------------------------

Apu::Apu() = default;
Apu::~Apu() = default;

void Apu::reset() {
    channel1_ = PulseChannel{};
    channel2_ = PulseChannel{};
    channel3_ = WaveChannel{};
    channel4_ = NoiseChannel{};
    powerOn_ = false;
    nr50_ = 0;
    nr51_ = 0;
    frameSequencerCounter_ = 0;
    frameSequencerStep_ = 0;
    sampleCycleAccumulator_ = 0;
    mixAccumLeft_ = 0.0f;
    mixAccumRight_ = 0.0f;
    mixAccumCount_ = 0;
    lowpassLeft_ = 0.0f;
    lowpassRight_ = 0.0f;
    dcBlockPrevInLeft_ = 0.0f;
    dcBlockPrevOutLeft_ = 0.0f;
    dcBlockPrevInRight_ = 0.0f;
    dcBlockPrevOutRight_ = 0.0f;
    sampleBuffer_.clear();
}

void Apu::powerOff() {
    const auto wave = channel3_.waveRam;
    channel1_ = PulseChannel{};
    channel2_ = PulseChannel{};
    channel3_ = WaveChannel{};
    channel4_ = NoiseChannel{};
    channel3_.waveRam = wave;
    nr50_ = 0;
    nr51_ = 0;
    frameSequencerStep_ = 0;
}

void Apu::stepFrameSequencer() {
    frameSequencerStep_ = (frameSequencerStep_ + 1) & 0x07;
    if ((frameSequencerStep_ & 0x01) == 0) {
        channel1_.stepLength();
        channel2_.stepLength();
        channel3_.stepLength();
        channel4_.stepLength();
    }
    if (frameSequencerStep_ == 2 || frameSequencerStep_ == 6) {
        channel1_.stepSweep();
    }
    if (frameSequencerStep_ == 7) {
        channel1_.stepEnvelope();
        channel2_.stepEnvelope();
        channel4_.stepEnvelope();
    }
}

void Apu::accumulateMix() {
    // Silenced channels (disabled, or DAC off) contribute 0, and live ones
    // are centred on their own midpoint (centeredOutput()) instead of the
    // real DAC's fixed -1 floor. With a fixed floor, merely triggering a
    // channel at volume 0 -- which many games do for all four channels at
    // boot -- steps the mix from 0 to -1, and the DC-blocking filter turns
    // that step into a loud decaying thump. Centring makes a silent channel
    // contribute 0 whether or not it is running, and leaves the audible
    // swing (half the volume either side of zero) unchanged.
    float left = 0.0f;
    float right = 0.0f;

    if (powerOn_) {
        const float c1 = channel1_.centeredOutput();
        const float c2 = channel2_.centeredOutput();
        const float c3 = channel3_.centeredOutput();
        const float c4 = channel4_.centeredOutput();

        const bool c1On = channel1_.enabled && channel1_.dacEnabled;
        const bool c2On = channel2_.enabled && channel2_.dacEnabled;
        const bool c3On = channel3_.enabled && channel3_.dacPower;
        const bool c4On = channel4_.enabled && channel4_.dacEnabled;

        if (nr51_ & 0x01) right += c1On ? c1 : 0.0f;
        if (nr51_ & 0x02) right += c2On ? c2 : 0.0f;
        if (nr51_ & 0x04) right += c3On ? c3 : 0.0f;
        if (nr51_ & 0x08) right += c4On ? c4 : 0.0f;
        if (nr51_ & 0x10) left += c1On ? c1 : 0.0f;
        if (nr51_ & 0x20) left += c2On ? c2 : 0.0f;
        if (nr51_ & 0x40) left += c3On ? c3 : 0.0f;
        if (nr51_ & 0x80) left += c4On ? c4 : 0.0f;

        left /= 4.0f;
        right /= 4.0f;

        const float leftVolume = static_cast<float>(((nr50_ >> 4) & 0x07) + 1) / 8.0f;
        const float rightVolume = static_cast<float>((nr50_ & 0x07) + 1) / 8.0f;
        left *= leftVolume;
        right *= rightVolume;
    }

    mixAccumLeft_ += left;
    mixAccumRight_ += right;
    ++mixAccumCount_;
}

void Apu::emitSample() {
    const float left = mixAccumCount_ > 0 ? mixAccumLeft_ / static_cast<float>(mixAccumCount_) : 0.0f;
    const float right = mixAccumCount_ > 0 ? mixAccumRight_ / static_cast<float>(mixAccumCount_) : 0.0f;
    mixAccumLeft_ = 0.0f;
    mixAccumRight_ = 0.0f;
    mixAccumCount_ = 0;

    const float lowPassAlpha = onePoleAlpha(sampleRate_, kLowPassCutoffHz);
    lowpassLeft_ += lowPassAlpha * (left - lowpassLeft_);
    lowpassRight_ += lowPassAlpha * (right - lowpassRight_);

    const float dcBlockR = 1.0f - onePoleAlpha(sampleRate_, kDcBlockCutoffHz);
    const float dcOutLeft = lowpassLeft_ - dcBlockPrevInLeft_ + dcBlockR * dcBlockPrevOutLeft_;
    dcBlockPrevInLeft_ = lowpassLeft_;
    dcBlockPrevOutLeft_ = dcOutLeft;
    const float dcOutRight = lowpassRight_ - dcBlockPrevInRight_ + dcBlockR * dcBlockPrevOutRight_;
    dcBlockPrevInRight_ = lowpassRight_;
    dcBlockPrevOutRight_ = dcOutRight;

    sampleBuffer_.push_back(dcOutLeft);
    sampleBuffer_.push_back(dcOutRight);
}

void Apu::tick(int tCycles) {
    for (int i = 0; i < tCycles; ++i) {
        if (powerOn_) {
            channel1_.stepFrequency();
            channel2_.stepFrequency();
            channel3_.stepFrequency();
            channel4_.stepFrequency();

            if (++frameSequencerCounter_ >= kFrameSequencerPeriod) {
                frameSequencerCounter_ -= kFrameSequencerPeriod;
                stepFrameSequencer();
            }
        }

        accumulateMix();

        sampleCycleAccumulator_ += sampleRate_;
        if (sampleCycleAccumulator_ >= kClockRate) {
            sampleCycleAccumulator_ -= kClockRate;
            emitSample();
        }
    }
}

uint8_t Apu::read8(uint16_t address) const {
    if (address >= kWaveRamStart && address <= kWaveRamEnd) {
        return channel3_.waveRam[address - kWaveRamStart];
    }

    switch (address) {
        case kNr10:
            return 0x80 | (channel1_.sweepPeriod << 4) | (channel1_.sweepNegate ? 0x08 : 0) |
                   channel1_.sweepShift;
        case kNr11:
            return 0x3F | (channel1_.duty << 6);
        case kNr12:
            return (channel1_.envelopeInitialVolume << 4) | (channel1_.envelopeIncrease ? 0x08 : 0) |
                   channel1_.envelopePeriod;
        case kNr13:
            return 0xFF;
        case kNr14:
            return 0xBF | (channel1_.lengthEnabled ? 0x40 : 0);

        case kNr21:
            return 0x3F | (channel2_.duty << 6);
        case kNr22:
            return (channel2_.envelopeInitialVolume << 4) | (channel2_.envelopeIncrease ? 0x08 : 0) |
                   channel2_.envelopePeriod;
        case kNr23:
            return 0xFF;
        case kNr24:
            return 0xBF | (channel2_.lengthEnabled ? 0x40 : 0);

        case kNr30:
            return 0x7F | (channel3_.dacPower ? 0x80 : 0);
        case kNr31:
            return 0xFF;
        case kNr32:
            return 0x9F | (channel3_.volumeCode << 5);
        case kNr33:
            return 0xFF;
        case kNr34:
            return 0xBF | (channel3_.lengthEnabled ? 0x40 : 0);

        case kNr41:
            return 0xFF;
        case kNr42:
            return (channel4_.envelopeInitialVolume << 4) | (channel4_.envelopeIncrease ? 0x08 : 0) |
                   channel4_.envelopePeriod;
        case kNr43:
            return (channel4_.clockShift << 4) | (channel4_.widthMode7Bit ? 0x08 : 0) | channel4_.divisorCode;
        case kNr44:
            return 0xBF | (channel4_.lengthEnabled ? 0x40 : 0);

        case kNr50:
            return nr50_;
        case kNr51:
            return nr51_;
        case kNr52: {
            uint8_t status = 0x70 | (powerOn_ ? 0x80 : 0);
            if (channel1_.enabled) status |= 0x01;
            if (channel2_.enabled) status |= 0x02;
            if (channel3_.enabled) status |= 0x04;
            if (channel4_.enabled) status |= 0x08;
            return status;
        }
        default:
            return 0xFF;
    }
}

void Apu::write8(uint16_t address, uint8_t value) {
    // Wave RAM stays accessible regardless of power state.
    if (address >= kWaveRamStart && address <= kWaveRamEnd) {
        channel3_.waveRam[address - kWaveRamStart] = value;
        channel3_.waveMeanValid = false;
        return;
    }

    if (address == kNr52) {
        const bool turningOn = (value & 0x80) != 0;
        if (powerOn_ && !turningOn) {
            powerOff();
        }
        powerOn_ = turningOn;
        return;
    }

    // All other sound registers are inert while the APU is powered off.
    if (!powerOn_) return;

    switch (address) {
        case kNr10:
            channel1_.sweepPeriod = (value >> 4) & 0x07;
            channel1_.sweepNegate = (value & 0x08) != 0;
            channel1_.sweepShift = value & 0x07;
            break;
        case kNr11:
            channel1_.duty = (value >> 6) & 0x03;
            channel1_.lengthCounter = 64 - (value & 0x3F);
            break;
        case kNr12:
            channel1_.envelopeInitialVolume = (value >> 4) & 0x0F;
            channel1_.envelopeIncrease = (value & 0x08) != 0;
            channel1_.envelopePeriod = value & 0x07;
            channel1_.dacEnabled = (value & 0xF8) != 0;
            if (!channel1_.dacEnabled) channel1_.enabled = false;
            break;
        case kNr13:
            channel1_.frequency = (channel1_.frequency & 0x0700) | value;
            break;
        case kNr14:
            channel1_.frequency = static_cast<uint16_t>((channel1_.frequency & 0x00FF) | ((value & 0x07) << 8));
            channel1_.lengthEnabled = (value & 0x40) != 0;
            if (value & 0x80) channel1_.trigger(/*hasSweep=*/true);
            break;

        case kNr21:
            channel2_.duty = (value >> 6) & 0x03;
            channel2_.lengthCounter = 64 - (value & 0x3F);
            break;
        case kNr22:
            channel2_.envelopeInitialVolume = (value >> 4) & 0x0F;
            channel2_.envelopeIncrease = (value & 0x08) != 0;
            channel2_.envelopePeriod = value & 0x07;
            channel2_.dacEnabled = (value & 0xF8) != 0;
            if (!channel2_.dacEnabled) channel2_.enabled = false;
            break;
        case kNr23:
            channel2_.frequency = (channel2_.frequency & 0x0700) | value;
            break;
        case kNr24:
            channel2_.frequency = static_cast<uint16_t>((channel2_.frequency & 0x00FF) | ((value & 0x07) << 8));
            channel2_.lengthEnabled = (value & 0x40) != 0;
            if (value & 0x80) channel2_.trigger(/*hasSweep=*/false);
            break;

        case kNr30:
            channel3_.dacPower = (value & 0x80) != 0;
            if (!channel3_.dacPower) channel3_.enabled = false;
            break;
        case kNr31:
            channel3_.lengthCounter = 256 - value;
            break;
        case kNr32:
            channel3_.volumeCode = (value >> 5) & 0x03;
            channel3_.waveMeanValid = false;
            break;
        case kNr33:
            channel3_.frequency = (channel3_.frequency & 0x0700) | value;
            break;
        case kNr34:
            channel3_.frequency = static_cast<uint16_t>((channel3_.frequency & 0x00FF) | ((value & 0x07) << 8));
            channel3_.lengthEnabled = (value & 0x40) != 0;
            if (value & 0x80) channel3_.trigger();
            break;

        case kNr41:
            channel4_.lengthCounter = 64 - (value & 0x3F);
            break;
        case kNr42:
            channel4_.envelopeInitialVolume = (value >> 4) & 0x0F;
            channel4_.envelopeIncrease = (value & 0x08) != 0;
            channel4_.envelopePeriod = value & 0x07;
            channel4_.dacEnabled = (value & 0xF8) != 0;
            if (!channel4_.dacEnabled) channel4_.enabled = false;
            break;
        case kNr43:
            channel4_.clockShift = (value >> 4) & 0x0F;
            channel4_.widthMode7Bit = (value & 0x08) != 0;
            channel4_.divisorCode = value & 0x07;
            break;
        case kNr44:
            channel4_.lengthEnabled = (value & 0x40) != 0;
            if (value & 0x80) channel4_.trigger();
            break;

        case kNr50:
            nr50_ = value;
            break;
        case kNr51:
            nr51_ = value;
            break;
        default:
            break;
    }
}

void Apu::saveState(StateWriter& writer) const {
    channel1_.saveState(writer);
    channel2_.saveState(writer);
    channel3_.saveState(writer);
    channel4_.saveState(writer);
    writer.writeBool(powerOn_);
    writer.writeU8(nr50_);
    writer.writeU8(nr51_);
    writer.writeU32(static_cast<uint32_t>(frameSequencerCounter_));
    writer.writeU8(frameSequencerStep_);
    writer.writeU32(static_cast<uint32_t>(sampleCycleAccumulator_));
}

void Apu::loadState(StateReader& reader) {
    channel1_.loadState(reader);
    channel2_.loadState(reader);
    channel3_.loadState(reader);
    channel4_.loadState(reader);
    powerOn_ = reader.readBool();
    nr50_ = reader.readU8();
    nr51_ = reader.readU8();
    frameSequencerCounter_ = static_cast<int>(reader.readU32());
    frameSequencerStep_ = reader.readU8();
    sampleCycleAccumulator_ = static_cast<int>(reader.readU32());
    sampleBuffer_.clear();
    mixAccumLeft_ = 0.0f;
    mixAccumRight_ = 0.0f;
    mixAccumCount_ = 0;
    lowpassLeft_ = 0.0f;
    lowpassRight_ = 0.0f;
    dcBlockPrevInLeft_ = 0.0f;
    dcBlockPrevOutLeft_ = 0.0f;
    dcBlockPrevInRight_ = 0.0f;
    dcBlockPrevOutRight_ = 0.0f;
}

} // namespace gb
