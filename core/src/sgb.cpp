#include "gb/sgb.hpp"

#include <algorithm>

#include "gb/ppu.hpp"

namespace gb {

namespace {
// Command codes (first byte of a command, bits 3-7).
constexpr uint8_t kCmdPal01 = 0x00;
constexpr uint8_t kCmdPal23 = 0x01;
constexpr uint8_t kCmdPal03 = 0x02;
constexpr uint8_t kCmdPal12 = 0x03;
constexpr uint8_t kCmdAttrBlk = 0x04;
constexpr uint8_t kCmdAttrLin = 0x05;
constexpr uint8_t kCmdAttrDiv = 0x06;
constexpr uint8_t kCmdAttrChr = 0x07;
constexpr uint8_t kCmdPalSet = 0x0A;
constexpr uint8_t kCmdPalTrn = 0x0B;
constexpr uint8_t kCmdMltReq = 0x11;
constexpr uint8_t kCmdAttrTrn = 0x15;
constexpr uint8_t kCmdAttrSet = 0x16;
constexpr uint8_t kCmdMaskEn = 0x17;

// The game writes a packet as: a reset pulse (both lines low), 128 data bits
// LSB first, then a 0 stop bit. A bit is sent by pulling one line low for a
// moment and releasing both: P14 low (0x20 in bits 4-5) = 0, P15 low (0x10)
// = 1.
constexpr uint8_t kLinesBothLow = 0x00;
constexpr uint8_t kLinesReleased = 0x30;
constexpr uint8_t kLineOneBit = 0x10;
constexpr int kPacketBits = 128;

constexpr int kVBlanksBeforeTransfer = 1;
} // namespace

Sgb::Sgb() {
    reset();
}

void Sgb::reset() {
    lastSelect_ = kLinesReleased;
    receiving_ = false;
    bitCount_ = 0;
    command_.fill(0);
    packet_.fill(0);
    packetsReceived_ = 0;
    packetsExpected_ = 0;
    playerCount_ = 1;
    currentPlayer_ = 0;
    hasColors_ = false;
    mask_ = Mask::kNone;
    for (auto& palette : palettes_) palette.fill(0);
    for (int p = 0; p < kPaletteCount; ++p) {
        for (int i = 0; i < 4; ++i) updateRgb(p, i);
    }
    attributes_.fill(0);
    for (auto& entry : paletteRam_) entry.fill(0);
    attributeFiles_.fill(0);
    pendingTransfer_ = Transfer::kNone;
    transferDelay_ = 0;
}

void Sgb::setEnabled(bool enabled) {
    if (enabled_ == enabled) {
        return;
    }
    enabled_ = enabled;
    reset();
}

int Sgb::joypadIdNibble(uint8_t selectBits) const {
    if (!enabled_ || playerCount_ <= 1 || (selectBits & 0x30) != 0x30) {
        return -1;
    }
    return 0x0F - currentPlayer_;
}

void Sgb::onJoypadWrite(uint8_t selectBits) {
    const uint8_t previous = lastSelect_;
    lastSelect_ = selectBits;
    if (!enabled_) {
        return;
    }

    // With several controllers, the next one is selected each time P15 goes
    // back high (0x10 -> 0x30 when reading buttons).
    if (playerCount_ > 1 && (previous & 0x20) == 0 && (selectBits & 0x20) != 0) {
        currentPlayer_ = (currentPlayer_ + 1) % playerCount_;
    }

    if (selectBits == kLinesBothLow) {
        receiving_ = true;
        bitCount_ = 0;
        packet_.fill(0);
        return;
    }
    if (!receiving_ || selectBits == kLinesReleased || previous != kLinesReleased) {
        return;
    }

    const bool bit = selectBits == kLineOneBit;
    if (bitCount_ < kPacketBits) {
        if (bit) {
            packet_[bitCount_ / 8] |= static_cast<uint8_t>(1 << (bitCount_ % 8));
        }
        ++bitCount_;
        return;
    }

    // Stop bit.
    receiving_ = false;
    if (!bit) {
        finishPacket();
    }
}

void Sgb::finishPacket() {
    if (packetsReceived_ == 0) {
        packetsExpected_ = std::clamp(packet_[0] & 0x07, 1, kMaxPackets);
    }
    std::copy(packet_.begin(), packet_.end(), command_.begin() + packetsReceived_ * kPacketBytes);
    if (++packetsReceived_ >= packetsExpected_) {
        packetsReceived_ = 0;
        runCommand();
    }
}

void Sgb::updateRgb(int palette, int index) {
    const uint16_t color = palettes_[palette][index];
    const auto expand = [](uint16_t channel) {
        return static_cast<uint8_t>((channel << 3) | (channel >> 2));
    };
    uint8_t* out = &rgb_[(palette * 4 + index) * 3];
    out[0] = expand(color & 0x1F);
    out[1] = expand((color >> 5) & 0x1F);
    out[2] = expand((color >> 10) & 0x1F);
}

void Sgb::setColor(int palette, int index, uint16_t rgb555) {
    palettes_[palette][index] = rgb555 & 0x7FFF;
    updateRgb(palette, index);
}

// Color 0 is the backdrop, shared by every palette (palette 0's wins).
// Refreshes the RGB colors of all four palettes.
void Sgb::applyBackdrop() {
    for (int p = 1; p < kPaletteCount; ++p) {
        palettes_[p][0] = palettes_[0][0];
    }
    for (int p = 0; p < kPaletteCount; ++p) {
        for (int i = 0; i < 4; ++i) updateRgb(p, i);
    }
}

void Sgb::runCommand() {
    const auto word = [this](int offset) {
        return static_cast<uint16_t>(command_[offset] | (command_[offset + 1] << 8));
    };

    switch (command_[0] >> 3) {
        case kCmdPal01: setPaletteColors(0, 1); break;
        case kCmdPal23: setPaletteColors(2, 3); break;
        case kCmdPal03: setPaletteColors(0, 3); break;
        case kCmdPal12: setPaletteColors(1, 2); break;
        case kCmdAttrBlk: attrBlock(); break;
        case kCmdAttrLin: attrLine(); break;
        case kCmdAttrDiv: attrDivide(); break;
        case kCmdAttrChr: attrCharacter(); break;
        case kCmdPalSet: {
            for (int p = 0; p < kPaletteCount; ++p) {
                palettes_[p] = paletteRam_[word(1 + p * 2) & 0x1FF];
            }
            applyBackdrop();
            hasColors_ = true;
            const uint8_t flags = command_[9];
            if (flags & 0x80) applyAttributeFile(flags & 0x3F);
            if (flags & 0x40) mask_ = Mask::kNone;
            break;
        }
        case kCmdPalTrn:
            pendingTransfer_ = Transfer::kPalette;
            transferDelay_ = kVBlanksBeforeTransfer;
            break;
        case kCmdAttrTrn:
            pendingTransfer_ = Transfer::kAttribute;
            transferDelay_ = kVBlanksBeforeTransfer;
            break;
        case kCmdAttrSet:
            applyAttributeFile(command_[1] & 0x3F);
            if (command_[1] & 0x40) mask_ = Mask::kNone;
            break;
        case kCmdMaskEn:
            mask_ = static_cast<Mask>(command_[1] & 0x03);
            break;
        case kCmdMltReq:
            switch (command_[1] & 0x03) {
                case 1: playerCount_ = 2; break;
                case 3: playerCount_ = 4; break;
                default: playerCount_ = 1; break;
            }
            currentPlayer_ = 0;
            break;
        default:
            break; // border, sound, SNES-side and icon commands: not emulated
    }
}

// PAL01/PAL23/PAL03/PAL12: one shared color 0, then colors 1-3 of two palettes.
void Sgb::setPaletteColors(int first, int second) {
    const auto word = [this](int offset) {
        return static_cast<uint16_t>(command_[offset] | (command_[offset + 1] << 8));
    };
    palettes_[0][0] = word(1) & 0x7FFF;
    for (int i = 1; i <= 3; ++i) {
        palettes_[first][i] = word(1 + i * 2) & 0x7FFF;
        palettes_[second][i] = word(7 + i * 2) & 0x7FFF;
    }
    applyBackdrop();
    hasColors_ = true;
}

void Sgb::applyAttributeFile(int index) {
    if (index >= kAttributeFiles) {
        return;
    }
    const uint8_t* file = &attributeFiles_[index * kAttributeFileBytes];
    for (int cell = 0; cell < kAttributeBytes; ++cell) {
        attributes_[cell] = (file[cell / 4] >> (6 - (cell % 4) * 2)) & 0x03;
    }
}

void Sgb::fillRect(int x1, int y1, int x2, int y2, uint8_t palette) {
    for (int y = std::max(y1, 0); y <= std::min(y2, kCellsY - 1); ++y) {
        for (int x = std::max(x1, 0); x <= std::min(x2, kCellsX - 1); ++x) {
            attributes_[y * kCellsX + x] = palette;
        }
    }
}

void Sgb::attrBlock() {
    const int count = std::min<int>(command_[1], 18);
    for (int i = 0; i < count; ++i) {
        const uint8_t* set = &command_[2 + i * 6];
        const bool changeInside = set[0] & 0x01;
        bool changeBorder = set[0] & 0x02;
        const bool changeOutside = set[0] & 0x04;
        const uint8_t inside = set[1] & 0x03;
        uint8_t border = (set[1] >> 2) & 0x03;
        const uint8_t outside = (set[1] >> 4) & 0x03;

        // Changing only the inside or only the outside also recolors the
        // surrounding line to match.
        if (!changeBorder && changeInside && !changeOutside) {
            changeBorder = true;
            border = inside;
        } else if (!changeBorder && changeOutside && !changeInside) {
            changeBorder = true;
            border = outside;
        }

        int x1 = set[2] & 0x1F, y1 = set[3] & 0x1F;
        int x2 = set[4] & 0x1F, y2 = set[5] & 0x1F;
        if (x1 > x2) std::swap(x1, x2);
        if (y1 > y2) std::swap(y1, y2);

        for (int y = 0; y < kCellsY; ++y) {
            for (int x = 0; x < kCellsX; ++x) {
                uint8_t& cell = attributes_[y * kCellsX + x];
                if (x < x1 || x > x2 || y < y1 || y > y2) {
                    if (changeOutside) cell = outside;
                } else if (x == x1 || x == x2 || y == y1 || y == y2) {
                    if (changeBorder) cell = border;
                } else if (changeInside) {
                    cell = inside;
                }
            }
        }
    }
}

void Sgb::attrLine() {
    const int count = std::min<int>(command_[1], 110);
    for (int i = 0; i < count; ++i) {
        const uint8_t data = command_[2 + i];
        const int line = data & 0x1F;
        const uint8_t palette = (data >> 5) & 0x03;
        if (data & 0x80) {
            fillRect(0, line, kCellsX - 1, line, palette); // horizontal line: row `line`
        } else {
            fillRect(line, 0, line, kCellsY - 1, palette); // vertical line: column `line`
        }
    }
}

void Sgb::attrDivide() {
    const uint8_t flags = command_[1];
    const uint8_t belowOrRight = flags & 0x03;
    const uint8_t aboveOrLeft = (flags >> 2) & 0x03;
    const uint8_t onLine = (flags >> 4) & 0x03;
    const bool horizontal = (flags & 0x40) != 0;
    const int line = command_[2] & 0x1F;

    for (int y = 0; y < kCellsY; ++y) {
        for (int x = 0; x < kCellsX; ++x) {
            const int position = horizontal ? y : x;
            attributes_[y * kCellsX + x] =
                position < line ? aboveOrLeft : (position == line ? onLine : belowOrRight);
        }
    }
}

void Sgb::attrCharacter() {
    int x = command_[1];
    int y = command_[2];
    const int count = std::min<int>(command_[3] | (command_[4] << 8), kAttributeBytes);
    const bool vertical = command_[5] != 0;

    for (int i = 0; i < count; ++i) {
        const uint8_t palette = (command_[6 + i / 4] >> (6 - (i % 4) * 2)) & 0x03;
        if (x < kCellsX && y < kCellsY) {
            attributes_[y * kCellsX + x] = palette;
        }
        if (vertical) {
            if (++y >= kCellsY) {
                y = 0;
                if (++x >= kCellsX) x = 0;
            }
        } else if (++x >= kCellsX) {
            x = 0;
            if (++y >= kCellsY) y = 0;
        }
    }
}

void Sgb::onVBlank(const uint8_t* framebuffer) {
    if (!enabled_ || pendingTransfer_ == Transfer::kNone) {
        return;
    }
    // The game keeps the data on screen for a few frames; skip the frame the
    // command arrived in, which may only be partly drawn.
    if (transferDelay_ > 0) {
        --transferDelay_;
        return;
    }
    receiveTransfer(framebuffer);
    pendingTransfer_ = Transfer::kNone;
}

// A *_TRN command's 4 KB payload is sent as the picture on the GB screen:
// the first 256 tiles of it, left to right then top to bottom, as ordinary
// 2-bit tile data. Reading the finished frame back (shades after BGP) is how
// the SGB sees it.
void Sgb::receiveTransfer(const uint8_t* framebuffer) {
    std::array<uint8_t, kTransferBytes> data{};
    for (int tile = 0; tile < 256; ++tile) {
        const int tileX = tile % kCellsX;
        const int tileY = tile / kCellsX;
        for (int row = 0; row < 8; ++row) {
            const uint8_t* pixels =
                framebuffer + (tileY * 8 + row) * Ppu::kScreenWidth + tileX * 8;
            uint8_t low = 0;
            uint8_t high = 0;
            for (int column = 0; column < 8; ++column) {
                const uint8_t shade = pixels[column] & 0x03;
                low |= static_cast<uint8_t>((shade & 1) << (7 - column));
                high |= static_cast<uint8_t>((shade >> 1) << (7 - column));
            }
            data[tile * 16 + row * 2] = low;
            data[tile * 16 + row * 2 + 1] = high;
        }
    }

    if (pendingTransfer_ == Transfer::kPalette) {
        for (int entry = 0; entry < kPaletteRamEntries; ++entry) {
            for (int i = 0; i < 4; ++i) {
                const int offset = entry * 8 + i * 2;
                paletteRam_[entry][i] =
                    static_cast<uint16_t>((data[offset] | (data[offset + 1] << 8)) & 0x7FFF);
            }
        }
    } else {
        std::copy_n(data.begin(), attributeFiles_.size(), attributeFiles_.begin());
    }
}

void Sgb::saveState(StateWriter& writer) const {
    writer.writeBool(enabled_);
    writer.writeU8(lastSelect_);
    writer.writeBool(receiving_);
    writer.writeU32(static_cast<uint32_t>(bitCount_));
    writer.writeBytes(command_.data(), command_.size());
    writer.writeU32(static_cast<uint32_t>(packetsReceived_));
    writer.writeU32(static_cast<uint32_t>(packetsExpected_));
    writer.writeBytes(packet_.data(), packet_.size());
    writer.writeU8(static_cast<uint8_t>(playerCount_));
    writer.writeU8(static_cast<uint8_t>(currentPlayer_));
    writer.writeBool(hasColors_);
    writer.writeU8(static_cast<uint8_t>(mask_));
    for (const auto& palette : palettes_) {
        for (const uint16_t color : palette) writer.writeU16(color);
    }
    writer.writeBytes(attributes_.data(), attributes_.size());
    for (const auto& entry : paletteRam_) {
        for (const uint16_t color : entry) writer.writeU16(color);
    }
    writer.writeBytes(attributeFiles_.data(), attributeFiles_.size());
    writer.writeU8(static_cast<uint8_t>(pendingTransfer_));
    writer.writeU32(static_cast<uint32_t>(transferDelay_));
}

void Sgb::loadState(StateReader& reader) {
    enabled_ = reader.readBool();
    lastSelect_ = reader.readU8();
    receiving_ = reader.readBool();
    bitCount_ = static_cast<int>(reader.readU32());
    reader.readBytes(command_.data(), command_.size());
    packetsReceived_ = static_cast<int>(reader.readU32());
    packetsExpected_ = static_cast<int>(reader.readU32());
    reader.readBytes(packet_.data(), packet_.size());
    playerCount_ = reader.readU8();
    currentPlayer_ = reader.readU8();
    hasColors_ = reader.readBool();
    mask_ = static_cast<Mask>(reader.readU8() & 0x03);
    for (auto& palette : palettes_) {
        for (uint16_t& color : palette) color = reader.readU16();
    }
    reader.readBytes(attributes_.data(), attributes_.size());
    for (auto& entry : paletteRam_) {
        for (uint16_t& color : entry) color = reader.readU16();
    }
    reader.readBytes(attributeFiles_.data(), attributeFiles_.size());
    pendingTransfer_ = static_cast<Transfer>(reader.readU8() % 3);
    transferDelay_ = static_cast<int>(reader.readU32());

    // Guard the values later used as indices/counters against a corrupt blob.
    bitCount_ = std::clamp(bitCount_, 0, kPacketBits);
    packetsReceived_ = std::clamp(packetsReceived_, 0, kMaxPackets - 1);
    packetsExpected_ = std::clamp(packetsExpected_, 0, kMaxPackets);
    playerCount_ = std::clamp(playerCount_, 1, 4);
    currentPlayer_ = std::clamp(currentPlayer_, 0, playerCount_ - 1);
    for (int p = 0; p < kPaletteCount; ++p) {
        for (int i = 0; i < 4; ++i) updateRgb(p, i);
    }
}

} // namespace gb
