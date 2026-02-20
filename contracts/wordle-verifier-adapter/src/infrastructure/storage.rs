use soroban_sdk::{contracttype, Address, Env};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Verifier,
}

/// Repository for admin configuration
pub struct AdminRepository;

impl AdminRepository {
    pub fn get_admin(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set")
    }

    pub fn set_admin(env: &Env, admin: &Address) {
        env.storage().instance().set(&DataKey::Admin, admin);
    }

    pub fn get_verifier(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Verifier)
            .expect("Verifier not set")
    }

    pub fn set_verifier(env: &Env, verifier: &Address) {
        env.storage().instance().set(&DataKey::Verifier, verifier);
    }
}
