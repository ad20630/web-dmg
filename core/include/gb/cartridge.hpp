#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

#include "gb/save_state.hpp"

namespace gb {

class Cartridge {
public:
    Cartridge();
    ~Cartridge();

    // Parses the header (MBC type, ROM/RAM size) and stores the ROM image.
    void load(const uint8_t* data, size_t size);

    // Header says the game supports a Super Game Boy (byte 0x146 == 0x03 and
    // old licensee code 0x14B == 0x33), which a real SGB requires before it
    // will listen to the game.
    bool supportsSgb() const;

    uint8_t read8(uint16_t address) const;  // 0x0000-0x7FFF, 0xA000-0xBFFF
    void write8(uint16_t address, uint8_t value);

    // Cartridge RAM access for battery-save persistence. ramSize() is 0 for
    // carts with no RAM (nothing to persist). MBC3's RTC registers are kept
    // separately and are not part of this blob, so a saved game keeps its
    // clock in sync with real time rather than the time the save was made.
    const uint8_t* ramData() const { return ram_.data(); }
    size_t ramSize() const { return ram_.size(); }
    void setRamData(const uint8_t* data, size_t size);

    // Unlike ramData()/setRamData(), this snapshot includes MBC banking
    // state and the RTC (both live and latched), so a save state resumes
    // mid-game rather than just at power-on with the right cart RAM. The ROM
    // image itself is never included; loadState() assumes the same ROM that
    // was saved from is already loaded via load().
    void saveState(StateWriter& writer) const;
    void loadState(StateReader& reader);

private:
    enum class MbcType : uint8_t { None, Mbc1, Mbc2, Mbc3, Mbc5 };

    // MBC3's real-time clock. "Live" ticks continuously in real time while
    // unhalted; "latched" is a frozen snapshot games read from, updated only
    // by the 0x00->0x01 latch-clock-data sequence.
    struct Rtc {
        uint8_t seconds = 0;
        uint8_t minutes = 0;
        uint8_t hours = 0;
        uint16_t days = 0;     // 9-bit day counter
        bool halted = false;
        bool dayCarry = false; // sticky overflow flag (day counter > 511)
    };

    std::vector<uint8_t> rom_;
    std::vector<uint8_t> ram_;

    MbcType mbcType_ = MbcType::None;
    bool hasRtc_ = false;
    bool ramEnabled_ = false;

    uint8_t romBankLow_ = 1;   // MBC1: 5 bits, MBC2: 4 bits, MBC3: 7 bits, MBC5: low 8 bits
    uint8_t romBankHigh_ = 0;  // MBC5 only: bit 8 of the ROM bank
    uint8_t ramBank_ = 0;
    uint8_t bankingMode_ = 0;  // MBC1 only: 0 = ROM banking mode, 1 = RAM banking mode

    uint8_t rtcSelect_ = 0;        // MBC3: last value written to 0x4000-0x5FFF
    uint8_t rtcLatchStage_ = 0xFF; // MBC3: tracks the 0x00 -> 0x01 latch sequence
    Rtc rtcLive_{};
    Rtc rtcLatched_{};
    long long rtcLastSyncMs_ = 0;  // wall-clock ms the live registers were last advanced to

    uint32_t romBank(uint16_t address) const;
    size_t ramOffset(uint16_t address) const;
    bool rtcRegisterSelected() const;

    void writeMbc1(uint16_t address, uint8_t value);
    void writeMbc2(uint16_t address, uint8_t value);
    void writeMbc3(uint16_t address, uint8_t value);
    void writeMbc5(uint16_t address, uint8_t value);

    void syncRtc();
    uint8_t readRtcRegister(uint8_t reg) const;
    void writeRtcRegister(uint8_t reg, uint8_t value);
    void latchRtc();

    static void writeRtcState(StateWriter& writer, const Rtc& rtc);
    static void readRtcState(StateReader& reader, Rtc& rtc);
};

} // namespace gb
