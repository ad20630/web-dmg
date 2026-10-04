cmake_minimum_required(VERSION 3.16)
project(gb_core CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(GB_CORE_SOURCES
    src/cpu.cpp
    src/ppu.cpp
    src/mmu.cpp
    src/apu.cpp
    src/timer.cpp
    src/joypad.cpp
    src/sgb.cpp
    src/cartridge.cpp
    src/emulator.cpp
)

add_library(gb_core STATIC ${GB_CORE_SOURCES})
target_include_directories(gb_core PUBLIC include)

if(EMSCRIPTEN)
    add_executable(gb_core_wasm src/bindings.cpp)
    target_link_libraries(gb_core_wasm PRIVATE gb_core)

    set_target_properties(gb_core_wasm PROPERTIES
        OUTPUT_NAME "gb_core"
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_SOURCE_DIR}/../web/public/wasm"
    )

    target_link_options(gb_core_wasm PRIVATE
        "--bind"
        "-sMODULARIZE=1"
        "-sEXPORT_ES6=1"
        "-sEXPORT_NAME=createGbCoreModule"
        "-sENVIRONMENT=web"
        "-sALLOW_MEMORY_GROWTH=1"
    )
else()
    add_executable(rom_runner tools/rom_runner.cpp)
    target_link_libraries(rom_runner PRIVATE gb_core)
endif()
