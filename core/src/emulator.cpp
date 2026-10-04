#include "gb/emulator.hpp"

namespace gb {

namespace {
// 4194304 Hz / ~59.7275 Hz refresh rate.
constexpr int kCyclesPerFrame = 70224;

// Bumped whenever the save-state layout changes, so old/foreign blobs are
// rejected up front instead of partially applied.
constexpr uint8_t kSaveStateVersion = 3;
} // namespace

Emulator::Emulator() {
    joypad_.setSgb(&sgb_);
}
Emulator::~Emulator() = default;

void Emulator::reset() {
    cpu_.reset();
    timer_.reset();
    ppu_.reset();
    apu_.reset();
    joypad_.reset();
    sgb_.reset();
    mmu_.reset();
}

void Emulator::loadRom(const uint8_t* data, size_t size) {
    cartridge_.load(data, size);
    sgb_.setEnabled(sgbAllowed_ && cartridge_.supportsSgb());
}

void Emulator::setSgbEnabled(bool enabled) {
    sgbAllowed_ = enabled;
}

int Emulator::step() {
    const int cycles = cpu_.step(mmu_);
    if (timer_.tick(cycles)) {
        mmu_.requestInterrupt(Cpu::kInterruptTimer);
    }
    if (const uint8_t ppuInterrupts = ppu_.tick(cycles)) {
        mmu_.requestInterrupt(ppuInterrupts);
        if (ppuInterrupts & 0x01) { // VBlank: the frame is complete
            sgb_.onVBlank(ppu_.framebuffer());
        }
    }
    apu_.tick(cycles);
    if (joypad_.consumeInterrupt()) {
        mmu_.requestInterrupt(Cpu::kInterruptJoypad);
    }
    return cycles;
}

void Emulator::runFrame() {
    int cyclesThisFrame = 0;
    while (cyclesThisFrame < kCyclesPerFrame) {
        cyclesThisFrame += step();
    }
}

void Emulator::setButtonPressed(Joypad::Button button, bool pressed) {
    joypad_.setButtonPressed(button, pressed);
}

const std::vector<uint8_t>& Emulator::captureSaveState() {
    saveStateBuffer_.clear();
    StateWriter writer(saveStateBuffer_);
    writer.writeU8('G');
    writer.writeU8('B');
    writer.writeU8('S');
    writer.writeU8('T');
    writer.writeU8(kSaveStateVersion);
    cpu_.saveState(writer);
    timer_.saveState(writer);
    joypad_.saveState(writer);
    sgb_.saveState(writer);
    ppu_.saveState(writer);
    apu_.saveState(writer);
    mmu_.saveState(writer);
    cartridge_.saveState(writer);
    return saveStateBuffer_;
}

bool Emulator::loadState(const uint8_t* data, size_t size) {
    StateReader reader(data, size);
    const bool magicOk = reader.readU8() == 'G' && reader.readU8() == 'B' &&
                          reader.readU8() == 'S' && reader.readU8() == 'T';
    const uint8_t version = reader.readU8();
    if (!magicOk || version != kSaveStateVersion || !reader.ok()) {
        return false;
    }

    cpu_.loadState(reader);
    timer_.loadState(reader);
    joypad_.loadState(reader);
    sgb_.loadState(reader);
    ppu_.loadState(reader);
    apu_.loadState(reader);
    mmu_.loadState(reader);
    cartridge_.loadState(reader);
    return reader.ok();
}

} // namespace gb
