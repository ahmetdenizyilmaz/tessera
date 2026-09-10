//! Stable and preview use separate writable application state.
use std::path::PathBuf;

pub fn data_dir() -> PathBuf {
    dirs::home_dir()
        .expect("No home directory")
        .join(if cfg!(feature = "preview") {
            ".tessera-preview"
        } else {
            ".tessera"
        })
}

pub fn keyring_service(stable: &'static str) -> String {
    if cfg!(feature = "preview") {
        format!("{stable}-preview")
    } else {
        stable.to_string()
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn state_is_namespaced() {
        assert_eq!(
            super::data_dir().file_name().unwrap(),
            if cfg!(feature = "preview") {
                ".tessera-preview"
            } else {
                ".tessera"
            }
        );
        assert_eq!(
            super::keyring_service("tessera"),
            if cfg!(feature = "preview") {
                "tessera-preview"
            } else {
                "tessera"
            }
        );
    }
}
