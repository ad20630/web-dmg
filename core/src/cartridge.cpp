#include "gb/cartridge.hpp"

#include <algorithm>
#include <chrono>

namespace gb {

namespace {

constexpr uint16_t kMbcTypeAddress = 0x0147;
constexpr uint16_t kRamSizeAddress = 0x0149;

size_t ramSizeForCode(uint8_t code) {
    switch (code) {
    case 0x01: return 2 * 1024;   // unofficial, some carts use a partial bank
    case 0x02: return 8 * 1024;
    case 0x03: return 32 * 1024;
    case 0x04: return 128 * 1024;
    case 0x05: return 64 * 1024;
    default: return 0;
    }
}

long long nowMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}

} // namespace

Cartridge::Cartridge() = default;
Cartridge::~Cartridge() = default;

void Cartridge::load(const uint8_t* data, size_t size) {
    rom_.assign(data, data + size);

    const uint8_t typeCode = rom_.size() > kMbcTypeAddress ? rom_[kMbcTypeAddress] : 0;
    hasRtc_ = typeCode == 0x0F || typeCode == 0x10;
    switch (typeCode) {
    case 0x01: case 0x02: case 0x03:
        mbcType_ = MbcType::Mbc1;
        break;
    case 0x05: case 0x06:
        mbcType_ = MbcType::Mbc2;
        break;
    case 0x0F: case 0x10: case 0x11: case 0x12: case 0x13:
        mbcType_ = MbcType::Mbc3;
        break;
    case 0x19: case 0x1A: case 0x1B: case 0x1C: case 0x1D: case 0x1E:
        mbcType_ = MbcType::Mbc5;
        break;
    default:
        // Unimplemented MBC (MBC6/7, HuC1/3, MMM01, ...) or an unrecognized
        // code: fall back to a fixed bank 1 with always-enabled RAM, which
        // is correct for ROM-only carts.
        mbcType_ = MbcType::None;
        break;
    }

    if (mbcType_ == MbcType::Mbc2) {
        ram_.assign(512, 0); // built into the MBC2 chip; header RAM size is unused
    } else {
        const uint8_t ramSizeCode = rom_.size() > kRamSizeAddress ? rom_[kRamSizeAddress] : 0;
        ram_.assign(ramSizeForCode(ramSizeCode), 0);
    }

    ramEnabled_ = mbcType_ == MbcType::None; // non-banked carts have no enable gate
    romBankLow_ = 1;
    romBankHigh_ = 0;
    ramBank_ = 0;
    bankingMode_ = 0;
    rtcSelect_ = 0;
    rtcLatchStage_ = 0xFF;
    rtcLive_ = Rtc{};
    rtcLatched_ = Rtc{};
    rtcLastSyncMs_ = nowMs();
}

uint32_t Cartridge::romBank(uint16_t address) const {
    switch (mbcType_) {
    case MbcType::None:
        return address < 0x4000 ? 0 : 1;
    case MbcType::Mbc1:
        if (address < 0x4000) {
            // In RAM-banking mode the upper bits also steer the 0x0000-0x3FFF
            // window; this is a real MBC1 quirk (used by multicart boards),
            // harmless for ordinary MBC1 titles since it only bites when the
            // game is also switching RAM banks in that mode.
            return bankingMode_ == 1 ? (static_cast<uint32_t>(ramBank_) << 5) : 0;
        }
        return (static_cast<uint32_t>(ramBank_) << 5) | romBankLow_;
    case MbcType::Mbc2:
    case MbcType::Mbc3:
        return address < 0x4000 ? 0 : romBankLow_;
    case MbcType::Mbc5:
        if (address < 0x4000) return 0;
        return (static_cast<uint32_t>(romBankHigh_) << 8) | romBankLow_;
    }
    return 1;
}

size_t Cartridge::ramOffset(uint16_t address) const {
    if (mbcType_ == MbcType::Mbc2) {
        return static_cast<size_t>(address - 0xA000) % ram_.size();
    }
    const uint8_t bank = (mbcType_ == MbcType::Mbc1 && bankingMode_ == 0) ? 0 : ramBank_;
    return (static_cast<size_t>(bank) * 0x2000 + (address - 0xA000)) % ram_.size();
}

bool Cartridge::rtcRegisterSelected() const {
    return mbcType_ == MbcType::Mbc3 && hasRtc_ && rtcSelect_ >= 0x08 && rtcSelect_ <= 0x0C;
}

uint8_t Cartridge::read8(uint16_t address) const {
    if (address < 0x8000) {
        const size_t offset = static_cast<size_t>(romBank(address)) * 0x4000 + (address % 0x4000);
        return offset < rom_.size() ? rom_[offset] : 0xFF;
    }

    // 0xA000-0xBFFF: cartridge RAM (or MBC3's RTC registers)
    if (rtcRegisterSelected()) {
        return readRtcRegister(rtcSelect_);
    }
    if (!ramEnabled_ || ram_.empty()) {
        return 0xFF;
    }
    if (mbcType_ == MbcType::Mbc3 && rtcSelect_ > 0x03) {
        return 0xFF; // reserved select value: nothing mapped here
    }
    const size_t offset = ramOffset(address);
    if (mbcType_ == MbcType::Mbc2) {
        return static_cast<uint8_t>(0xF0 | (ram_[offset] & 0x0F)); // 4-bit RAM, upper nibble open bus
    }
    return ram_[offset];
}

void Cartridge::write8(uint16_t address, uint8_t value) {
    if (address < 0x8000) {
        switch (mbcType_) {
        case MbcType::None:
            return; // ROM-only carts ignore bank-control writes
        case MbcType::Mbc1:
            writeMbc1(address, value);
            return;
        case MbcType::Mbc2:
            writeMbc2(address, value);
            return;
        case MbcType::Mbc3:
            writeMbc3(address, value);
            return;
        case MbcType::Mbc5:
            writeMbc5(address, value);
            return;
        }
        return;
    }

    // 0xA000-0xBFFF: cartridge RAM (or MBC3's RTC registers)
    if (rtcRegisterSelected()) {
        writeRtcRegister(rtcSelect_, value);
        return;
    }
    if (!ramEnabled_ || ram_.empty()) {
        return;
    }
    if (mbcType_ == MbcType::Mbc3 && rtcSelect_ > 0x03) {
        return; // reserved select value: nothing mapped here
    }
    const size_t offset = ramOffset(address);
    ram_[offset] = (mbcType_ == MbcType::Mbc2) ? (value & 0x0F) : value;
}

void Cartridge::writeMbc1(uint16_t address, uint8_t value) {
    if (address < 0x2000) {
        ramEnabled_ = (value & 0x0F) == 0x0A;
    } else if (address < 0x4000) {
        romBankLow_ = value & 0x1F;
        if (romBankLow_ == 0) romBankLow_ = 1;
    } else if (address < 0x6000) {
        ramBank_ = value & 0x03;
    } else {
        bankingMode_ = value & 0x01;
    }
}

void Cartridge::writeMbc2(uint16_t address, uint8_t value) {
    if (address >= 0x4000) return;
    // The least-significant bit of the upper address byte picks which
    // register a write to 0x0000-0x3FFF hits.
    if (address & 0x0100) {
        romBankLow_ = value & 0x0F;
        if (romBankLow_ == 0) romBankLow_ = 1;
    } else {
        ramEnabled_ = (value & 0x0F) == 0x0A;
    }
}

void Cartridge::writeMbc3(uint16_t address, uint8_t value) {
    if (address < 0x2000) {
        ramEnabled_ = (value & 0x0F) == 0x0A;
    } else if (address < 0x4000) {
        romBankLow_ = value & 0x7F;
        if (romBankLow_ == 0) romBankLow_ = 1;
    } else if (address < 0x6000) {
        rtcSelect_ = value;
        if (value <= 0x03) ramBank_ = value;
    } else {
        if (rtcLatchStage_ == 0x00 && value == 0x01) {
            latchRtc();
        }
        rtcLatchStage_ = value;
    }
}

void Cartridge::writeMbc5(uint16_t address, uint8_t value) {
    if (address < 0x2000) {
        ramEnabled_ = (value & 0x0F) == 0x0A;
    } else if (address < 0x3000) {
        romBankLow_ = value;
    } else if (address < 0x4000) {
        romBankHigh_ = value & 0x01;
    } else if (address < 0x6000) {
        ramBank_ = value & 0x0F;
    }
    // Unlike MBC1/MBC2/MBC3, MBC5 has no "bank 0 -> bank 1" quirk: bank 0 is
    // directly selectable at 0x4000-0x7FFF.
}

void Cartridge::syncRtc() {
    const long long now = nowMs();
    if (rtcLive_.halted) {
        rtcLastSyncMs_ = now; // clock isn't ticking; don't fast-forward once resumed
        return;
    }
    long long elapsedSeconds = (now - rtcLastSyncMs_) / 1000;
    if (elapsedSeconds <= 0) return;
    rtcLastSyncMs_ += elapsedSeconds * 1000; // keep the sub-second remainder for next time

    long long total = rtcLive_.seconds + elapsedSeconds;
    rtcLive_.seconds = static_cast<uint8_t>(total % 60);
    total /= 60;

    total += rtcLive_.minutes;
    rtcLive_.minutes = static_cast<uint8_t>(total % 60);
    total /= 60;

    total += rtcLive_.hours;
    rtcLive_.hours = static_cast<uint8_t>(total % 24);
    total /= 24;

    total += rtcLive_.days;
    if (total > 0x1FF) {
        rtcLive_.dayCarry = true;
        total %= 0x200;
    }
    rtcLive_.days = static_cast<uint16_t>(total);
}

uint8_t Cartridge::readRtcRegister(uint8_t reg) const {
    switch (reg) {
    case 0x08: return rtcLatched_.seconds;
    case 0x09: return rtcLatched_.minutes;
    case 0x0A: return rtcLatched_.hours;
    case 0x0B: return static_cast<uint8_t>(rtcLatched_.days & 0xFF);
    case 0x0C: {
        uint8_t v = static_cast<uint8_t>((rtcLatched_.days >> 8) & 0x01);
        if (rtcLatched_.halted) v |= 0x40;
        if (rtcLatched_.dayCarry) v |= 0x80;
        return v;
    }
    default: return 0xFF;
    }
}

void Cartridge::writeRtcRegister(uint8_t reg, uint8_t value) {
    syncRtc(); // bring the live registers up to date before overwriting one field
    switch (reg) {
    case 0x08: rtcLive_.seconds = value % 60; break;
    case 0x09: rtcLive_.minutes = value % 60; break;
    case 0x0A: rtcLive_.hours = value % 24; break;
    case 0x0B: rtcLive_.days = (rtcLive_.days & 0x100) | value; break;
    case 0x0C:
        rtcLive_.days = (rtcLive_.days & 0x00FF) | (static_cast<uint16_t>(value & 0x01) << 8);
        rtcLive_.halted = (value & 0x40) != 0;
        rtcLive_.dayCarry = (value & 0x80) != 0;
        break;
    default: break;
    }
}

void Cartridge::latchRtc() {
    syncRtc();
    rtcLatched_ = rtcLive_;
}

bool Cartridge::supportsSgb() const {
    return rom_.size() > 0x14B && rom_[0x146] == 0x03 && rom_[0x14B] == 0x33;
}

void Cartridge::setRamData(const uint8_t* data, size_t size) {
    const size_t count = std::min(size, ram_.size());
    std::copy(data, data + count, ram_.begin());
}

void Cartridge::writeRtcState(StateWriter& writer, const Rtc& rtc) {
    writer.writeU8(rtc.seconds);
    writer.writeU8(rtc.minutes);
    writer.writeU8(rtc.hours);
    writer.writeU16(rtc.days);
    writer.writeBool(rtc.halted);
    writer.writeBool(rtc.dayCarry);
}

void Cartridge::readRtcState(StateReader& reader, Rtc& rtc) {
    rtc.seconds = reader.readU8();
    rtc.minutes = reader.readU8();
    rtc.hours = reader.readU8();
    rtc.days = reader.readU16();
    rtc.halted = reader.readBool();
    rtc.dayCarry = reader.readBool();
}

void Cartridge::saveState(StateWriter& writer) const {
    writer.writeU8(static_cast<uint8_t>(mbcType_));
    writer.writeBool(hasRtc_);
    writer.writeBool(ramEnabled_);
    writer.writeU8(romBankLow_);
    writer.writeU8(romBankHigh_);
    writer.writeU8(ramBank_);
    writer.writeU8(bankingMode_);
    writer.writeU8(rtcSelect_);
    writer.writeU8(rtcLatchStage_);
    writeRtcState(writer, rtcLive_);
    writeRtcState(writer, rtcLatched_);
    writer.writeU64(static_cast<uint64_t>(rtcLastSyncMs_));

    writer.writeU32(static_cast<uint32_t>(ram_.size()));
    writer.writeBytes(ram_.data(), ram_.size());
}

void Cartridge::loadState(StateReader& reader) {
    mbcType_ = static_cast<MbcType>(reader.readU8());
    hasRtc_ = reader.readBool();
    ramEnabled_ = reader.readBool();
    romBankLow_ = reader.readU8();
    romBankHigh_ = reader.readU8();
    ramBank_ = reader.readU8();
    bankingMode_ = reader.readU8();
    rtcSelect_ = reader.readU8();
    rtcLatchStage_ = reader.readU8();
    readRtcState(reader, rtcLive_);
    readRtcState(reader, rtcLatched_);
    rtcLastSyncMs_ = static_cast<long long>(reader.readU64());

    const uint32_t savedRamSize = reader.readU32();
    // ram_ is already sized for the currently-loaded ROM; only copy over
    // what fits so a save from a different/mismatched ROM can't resize it
    // or overrun.
    const size_t count = std::min<size_t>(savedRamSize, ram_.size());
    reader.readBytes(ram_.data(), count);
    if (savedRamSize > count) {
        std::vector<uint8_t> discard(savedRamSize - count);
        reader.readBytes(discard.data(), discard.size());
    }
}

} // namespace gb
