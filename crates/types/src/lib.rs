use hdk::prelude::*;
use std::collections::BTreeMap;

/// An applet instance
#[hdk_entry_helper]
#[derive(Clone)]
pub struct Applet {
    // name of the applet as chosen by the person adding it to the group,
    pub custom_name: String,
    pub description: String,
    pub sha256_happ: String,            // sha256 hash of the .happ file.
    pub sha256_webhapp: Option<String>, // sha256 hash of the .webhapp file if it's not a headless applet
    pub distribution_info: String, // Arbitrary String containing info about the distribution channel this applet
    // has been installed from. Conventions around the format of the string need to be defined in the frontend.
    pub meta_data: Option<String>, // Optional metadata. May be useful to add info without requiring to update the DNA
    pub network_seed: Option<String>,
    pub properties: BTreeMap<String, SerializedBytes>, // Segmented by RoleName
}

#[hdk_entry_helper]
#[derive(Clone)]
pub struct GroupProfile {
    pub name: String,
    pub logo_src: String,
}
