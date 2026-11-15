//! GUI-subsystem launcher: on Windows it never creates or flashes a console window.
//! On other systems it is identical to the console launcher.

#![windows_subsystem = "windows"]

fn main() {
    dropring_pack_launcher::main(true)
}
