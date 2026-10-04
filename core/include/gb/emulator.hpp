#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

#include "gb/apu.hpp"
#include "gb/cartridge.hpp"
#include "gb/cpu.hpp"
#include "gb/joypad.hpp"
#include "gb/mmu.hpp"
#include "gb/ppu.hpp"
#include "gb/save_state.hpp"
#include "gb/sgb.hpp"
#include "gb/timer.hpp"

namespace gb {

class Emulator {
public:
    Emulator();
    ~Emulator();

    void reset();
    void loadRom(const uint8_t* data, size_t size);
    int step();

    // Steps the emulator for one screen refresh's worth of cycles (~59.7 Hz).
    void runFrame();

    void setButtonPressed(Joypad::Button button, bool pressed);

    // Super Game Boy colorization (see Sgb). On by default; only takes effect
    // for ROMs whose header says they support an SGB. Takes effect at the
    // next loadRom().
    void setSgbEnabled(bool enabled);

    // Snapshots the full machine state (CPU/PPU/MMU/timer/joypad/cartridge,
    // including MBC banking and RTC) into saveStateBuffer_ and returns a
    // reference to it. The reference aliases internal storage and is only
    // valid until the next call to captureSaveState() or loadState().
    const std::vector<uint8_t>& captureSaveState();

    // Restores state previously produced by captureSaveState(). Assumes the
    // same ROM that was saved from has already been loaded via loadRom().
    // Returns false (leaving the machine in a possibly-mixed state) if the
    // blob is truncated or doesn't start with the expected header.
    bool loadState(const uint8_t* data, size_t size);

    Cpu& cpu() { return cpu_; }
    Mmu& mmu() { return mmu_; }
    Ppu& ppu() { return ppu_; }
    Apu& apu() { return apu_; }
    Joypad& joypad() { return joypad_; }
    const Sgb& sgb() const { return sgb_; }
    Cartridge& cartridge() { return cartridge_; }

private:
    // Declaration order matters: cartridge_/ppu_/apu_/timer_/joypad_ must
    // construct before mmu_, which holds references to them.
    Cartridge cartridge_;
    Ppu ppu_;
    Apu apu_;
    Timer timer_;
    Joypad joypad_;
    Sgb sgb_;
    Mmu mmu_{cartridge_, ppu_, apu_, timer_, joypad_};
    Cpu cpu_;

    bool sgbAllowed_ = true;
    std::vector<uint8_t> saveStateBuffer_;
};

} // namespace gb
