# Wordle Verifier Adapter

Adaptador que conecta el contrato Wordle con el verificador Groth16 genérico.

## Descripcion

Este contrato actúa como intermediario entre el juego Wordle y el verificador de ZK proofs. Su responsabilidad es:

1. Parsear el payload del proof (formato específico de Wordle)
2. Validar que los public inputs coincidan con el contexto del juego
3. Delegar la verificación criptográfica al contrato Groth16 genérico

## Arquitectura (Domain-Driven Design)

```
src/
├── lib.rs                 # Contrato principal
├── domain/
│   ├── mod.rs
│   ├── errors.rs          # VerifierError enum
│   └── proof.rs           # Groth16Proof, PayloadParser, PublicInputs
├── application/
│   ├── mod.rs
│   └── commands.rs        # VerifyProofCommand
└── infrastructure/
    ├── mod.rs
    ├── storage.rs         # AdminRepository
    └── external.rs        # Groth16VerifierGateway
```

## Formato del Payload

El proof payload tiene la siguiente estructura binaria:

```
Offset      Size        Campo
─────────────────────────────────────────
0           4 bytes     public_input_count (big-endian u32)
4           64 bytes    proof.a (G1 point)
68          128 bytes   proof.b (G2 point)
196         64 bytes    proof.c (G1 point)
260         N * 32      public_inputs (N field elements)
```

### Public Inputs para Wordle (15 total)

| Index | Campo | Descripcion |
|-------|-------|-------------|
| 0 | word_commitment_high | Primeros 16 bytes del commitment |
| 1 | word_commitment_low | Últimos 16 bytes del commitment |
| 2 | public_inputs_hash_high | Primeros 16 bytes del hash |
| 3 | public_inputs_hash_low | Últimos 16 bytes del hash |
| 4-8 | guess_letters[5] | 5 letras del guess (0-25 cada una) |
| 9-13 | feedback[5] | 5 valores de feedback (0-2 cada uno) |
| 14 | is_correct | 1 si la palabra es correcta, 0 si no |

## Interfaz del Contrato

### Funcion Principal

```rust
/// Verifica un ZK proof y lo vincula al contexto del juego
fn verify(
    word_commitment: BytesN<32>,     // Hash de la palabra secreta
    public_inputs_hash: BytesN<32>,  // Hash de los inputs públicos
    proof_payload: Bytes,            // Proof + public inputs serializados
) -> bool;
```

**Retorna `true` si:**
1. El payload tiene el formato correcto
2. Los public inputs contienen exactamente 15 elementos
3. El `word_commitment` en el payload coincide con el parámetro
4. El `public_inputs_hash` en el payload coincide con el parámetro
5. El verificador Groth16 acepta el proof

**Retorna `false` en cualquier otro caso** (no lanza errores para simplificar integración)

### Funciones Admin

```rust
fn get_admin() -> Address;
fn set_admin(new_admin: Address);
fn get_verifier() -> Address;
fn set_verifier(new_verifier: Address);
fn upgrade(new_wasm_hash: BytesN<32>);
```

## Flujo de Verificacion

```
                    Wordle Contract
                          │
                          ▼
            ┌─────────────────────────────┐
            │   WordleVerifierAdapter     │
            │                             │
            │  1. Parse payload           │
            │  2. Validate input count    │
            │  3. Check binding matches   │
            │  4. Call Groth16 verifier   │
            └─────────────────────────────┘
                          │
                          ▼
            ┌─────────────────────────────┐
            │   Groth16 Verifier          │
            │   (circom-groth16-verifier) │
            │                             │
            │  - Verificación BN254       │
            │  - Pairing check            │
            └─────────────────────────────┘
```

## Binding Validation

El adapter verifica que los valores en el payload coincidan con el contexto del juego:

```rust
// Los primeros 4 public inputs deben ser:
// [0] = word_commitment[0..16] (high bytes)
// [1] = word_commitment[16..32] (low bytes)
// [2] = public_inputs_hash[0..16] (high bytes)
// [3] = public_inputs_hash[16..32] (low bytes)
```

Esto previene ataques de replay donde alguien intenta usar un proof válido de otro juego.

## Tipos de Dominio

### Groth16Proof

```rust
pub struct Groth16Proof {
    pub a: G1Affine,   // 64 bytes
    pub b: G2Affine,   // 128 bytes
    pub c: G1Affine,   // 64 bytes
}
```

### VerifierError

```rust
pub enum VerifierError {
    InvalidProofFormat = 1,
    InvalidPublicInputsCount = 2,
    BindingMismatch = 3,
    VerificationFailed = 4,
}
```

## Dependencias

- **soroban-sdk**: SDK de Stellar Soroban
- **circom-groth16-verifier**: Verificador Groth16 genérico (contrato externo)

## Tests

```bash
cargo test -p wordle-verifier-adapter
```

5 tests cubren:
- Setup del adapter (admin, verifier)
- Rechazo de payload vacío
- Rechazo de payload muy corto
- Rechazo de binding incorrecto (commitment/hash no coinciden)
- Funciones admin (get/set verifier)

## Seguridad

- **Binding**: Cada proof está vinculado a un juego específico
- **No replay**: El hash de public inputs incluye session_id y jugadores
- **Fail-safe**: Retorna `false` en lugar de panic para errores de parsing
