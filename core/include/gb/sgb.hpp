#pragma once

#include <array>
#include <cstdint>

#include "gb/save_state.hpp"

namespace gb {

// Super Game Boy colorization. A real SGB is a cartridge adapter that
// listens to the game's writes to the joypad register (P1, bits 4-5) as a
// serial link: the game sends 16-byte command packets that set 4-color
// palettes and say which palette each 8x8 cell of the 20x18 screen uses
// (this is how Pokemon Red/Blue tints each town differently).
//
// This class decodes those packets and keeps the resulting state; it never
// touches the framebuffer. Callers combine it with Ppu::framebuffer(): a
// pixel's shade (bits 0-1) indexes into colors() for the palette that
// attributes() gives for the pixel's cell. The border, sound and
// SNES-side commands are ignored.
class Sgb {
public:
    static constexpr int kCellsX = 20;
    static constexpr int kCellsY = 18;
    static constexpr int kPaletteCount = 4;

    // What the SGB does with the screen on MASK_EN.
    enum class Mask : uint8_t {
        kNone = 0,
        kFreeze = 1,    // keep showing the last picture
        kBlack = 2,
        kBackdrop = 3,  // solid color 0
    };

    Sgb();

    void reset();

    // A game only talks to an SGB if its header says it supports one
    // (ROM byte 0x146 == 0x03, old licensee 0x14B == 0x33); otherwise the
    // real unit ignores it. While disabled nothing below has any effect.
    void setEnabled(bool enabled);
    bool enabled() const { return enabled_; }

    // Called with the bits 4-5 of every write to P1 (0xFF00).
    void onJoypadWrite(uint8_t selectBits);

    // With MLT_REQ multiplayer on, reading P1 with both lines deselected
    // returns the current player's ID instead of 0xF. Returns the low nibble
    // to use, or -1 when P1 reads normally.
    int joypadIdNibble(uint8_t selectBits) const;
    // Only player 1's controller is wired up; the others always read as idle.
    int currentPlayer() const { return currentPlayer_; }

    // Call at the start of every VBlank with the finished frame
    // (Ppu::framebuffer()): *_TRN commands copy their data out of the
    // picture the game is showing.
    void onVBlank(const uint8_t* framebuffer);

    // True once the game has set any palette, i.e. it is actually
    // colorizing; until then callers should show their own default palette.
    bool hasColors() const { return hasColors_; }
    Mask mask() const { return mask_; }

    // 4 palettes x 4 colors x (R, G, B), 8 bits each. Color 0 is shared by
    // all four palettes (it is the backdrop).
    const uint8_t* colors() const { return rgb_.data(); }
    static constexpr int kColorBytes = kPaletteCount * 4 * 3;

    // kCellsX * kCellsY palette numbers (0-3), row-major.
    const uint8_t* attributes() const { return attributes_.data(); }
    static constexpr int kAttributeBytes = kCellsX * kCellsY;

    void saveState(StateWriter& writer) const;
    void loadState(StateReader& reader);

private:
    static constexpr int kPacketBytes = 16;
    static constexpr int kMaxPackets = 7;
    static constexpr int kPaletteRamEntries = 512;
    static constexpr int kAttributeFiles = 45;
    static constexpr int kAttributeFileBytes = 90;
    static constexpr int kTransferBytes = 4096;

    enum class Transfer : uint8_t { kNone, kPalette, kAttribute };

    bool enabled_ = false;

    // Packet receive state machine.
    uint8_t lastSelect_ = 0x30;
    bool receiving_ = false;
    int bitCount_ = 0;
    std::array<uint8_t, kPacketBytes * kMaxPackets> command_{};
    int packetsReceived_ = 0;
    int packetsExpected_ = 0;
    std::array<uint8_t, kPacketBytes> packet_{};

    // Multiplayer joypad ID.
    int playerCount_ = 1;
    int currentPlayer_ = 0;

    // Output state.
    bool hasColors_ = false;
    Mask mask_ = Mask::kNone;
    std::array<std::array<uint16_t, 4>, kPaletteCount> palettes_{}; // RGB555
    std::array<uint8_t, kPaletteCount * 4 * 3> rgb_{};
    std::array<uint8_t, kAttributeBytes> attributes_{};

    // Data uploaded with PAL_TRN / ATTR_TRN.
    std::array<std::array<uint16_t, 4>, kPaletteRamEntries> paletteRam_{};
    std::array<uint8_t, kAttributeFiles * kAttributeFileBytes> attributeFiles_{};

    Transfer pendingTransfer_ = Transfer::kNone;
    int transferDelay_ = 0;

    void finishPacket();
    void runCommand();
    void setColor(int palette, int index, uint16_t rgb555);
    void updateRgb(int palette, int index);
    void applyBackdrop();
    void setPaletteColors(int first, int second);
    void setPalettesFromRam(const uint8_t* ids);
    void applyAttributeFile(int index);
    void fillRect(int x1, int y1, int x2, int y2, uint8_t palette);
    void attrBlock();
    void attrLine();
    void attrDivide();
    void attrCharacter();
    void receiveTransfer(const uint8_t* framebuffer);
};

} // namespace gb
