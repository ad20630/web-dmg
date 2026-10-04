#include "gb/joypad.hpp"

#include "gb/sgb.hpp"

namespace gb {

Joypad::Joypad() = default;
Joypad::~Joypad() = default;

void Joypad::reset() {
    selectBits_ = 0x30;
    directionState_ = 0x0F;
    actionState_ = 0x0F;
    lastOutputLow_ = 0x0F;
    interruptPending_ = false;
}

void Joypad::saveState(StateWriter& writer) const {
    writer.writeU8(selectBits_);
    writer.writeU8(directionState_);
    writer.writeU8(actionState_);
    writer.writeU8(lastOutputLow_);
    writer.writeBool(interruptPending_);
}

void Joypad::loadState(StateReader& reader) {
    selectBits_ = reader.readU8();
    directionState_ = reader.readU8();
    actionState_ = reader.readU8();
    lastOutputLow_ = reader.readU8();
    interruptPending_ = reader.readBool();
}

uint8_t Joypad::outputLowNibble() const {
    if (sgb_) {
        const int playerId = sgb_->joypadIdNibble(selectBits_);
        if (playerId >= 0) return static_cast<uint8_t>(playerId);
        if (sgb_->currentPlayer() != 0) return 0x0F; // other players' pads aren't connected
    }
    uint8_t nibble = 0x0F;
    if ((selectBits_ & 0x10) == 0) nibble &= directionState_;
    if ((selectBits_ & 0x20) == 0) nibble &= actionState_;
    return nibble;
}

void Joypad::refreshInterrupt() {
    const uint8_t nibble = outputLowNibble();
    if ((~nibble & lastOutputLow_) != 0) {
        interruptPending_ = true;
    }
    lastOutputLow_ = nibble;
}

uint8_t Joypad::read8() const {
    return 0xC0 | selectBits_ | outputLowNibble();
}

void Joypad::write8(uint8_t value) {
    selectBits_ = value & 0x30;
    if (sgb_) sgb_->onJoypadWrite(selectBits_);
    refreshInterrupt();
}

void Joypad::setButtonPressed(Button button, bool pressed) {
    uint8_t* state = nullptr;
    uint8_t bit = 0;
    switch (button) {
        case Button::kRight:  state = &directionState_; bit = 0x01; break;
        case Button::kLeft:   state = &directionState_; bit = 0x02; break;
        case Button::kUp:     state = &directionState_; bit = 0x04; break;
        case Button::kDown:   state = &directionState_; bit = 0x08; break;
        case Button::kA:      state = &actionState_;    bit = 0x01; break;
        case Button::kB:      state = &actionState_;    bit = 0x02; break;
        case Button::kSelect: state = &actionState_;    bit = 0x04; break;
        case Button::kStart:  state = &actionState_;    bit = 0x08; break;
    }
    if (pressed) {
        *state &= static_cast<uint8_t>(~bit);
    } else {
        *state |= bit;
    }
    refreshInterrupt();
}

bool Joypad::consumeInterrupt() {
    const bool pending = interruptPending_;
    interruptPending_ = false;
    return pending;
}

} // namespace gb
