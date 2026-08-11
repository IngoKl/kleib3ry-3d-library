// Keep the console window hidden in release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    library3d_lib::run()
}
