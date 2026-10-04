#pragma once

#include <cstdint>

#include "gb/save_state.hpp"

namespace gb {

class Sgb;

class Joypad {
public:
    enum class Button {
        kRight,
        kLeft,
        kUp,
        kDown,
        kA,
        kB,
        kSelect,
        kStart,
    };

    Joypad();
    ~Joypad();

    void reset();

    // Lets a Super Game Boy see writes to P1 and answer its multiplayer ID
    // reads. Optional; not owned.
    void setSgb(Sgb* sgb) { sgb_ = sgb; }

    uint8_t read8() const;  // 0xFF00 (P1/JOYP)
    void write8(uint8_t value);

    void setButtonPressed(Button button, bool pressed);
    bool consumeInterrupt();

    void saveState(StateWriter& writer) const;
    void loadState(StateReader& reader);

private:
    uint8_t selectBits_ = 0x30;    // bits 4/5 as last written by the game (active-low select)
    uint8_t directionState_ = 0x0F; // bits 0-3: Right,Left,Up,Down (active-low, 1 = released)
    uint8_t actionState_ = 0x0F;    // bits 0-3: A,B,Select,Start (active-low, 1 = released)
    uint8_t lastOutputLow_ = 0x0F;
    bool interruptPending_ = false;
    Sgb* sgb_ = nullptr;

    uint8_t outputLowNibble() const;
    void refreshInterrupt();
};

} // namespace gb
