# Wordle Contract

Contrato principal del juego Wordle on-chain con verificación Zero-Knowledge.

## Descripcion

Implementa un juego Wordle para dos jugadores donde:
- **Word Setter**: Elige una palabra secreta de 5 letras y la compromete via hash
- **Guesser**: Tiene 6 intentos para adivinar la palabra

La palabra nunca se revela on-chain. El feedback (correcto/presente/ausente) se verifica mediante ZK proofs, garantizando que el Word Setter no puede mentir sobre el resultado.

## Arquitectura (Domain-Driven Design)

```
src/
├── lib.rs                 # Contrato principal (thin wrapper)
├── domain/
│   ├── mod.rs
│   ├── errors.rs          # DomainError enum
│   ├── game.rs            # Game aggregate (estado y reglas)
│   ├── feedback.rs        # Feedback value object (0=absent, 1=present, 2=correct)
│   └── word.rs            # Guess, Word, constantes
├── application/
│   ├── mod.rs
│   ├── commands.rs        # StartGame, CommitWord, Guess, ResolveGuess
│   ├── queries.rs         # GetGame, GetRules
│   └── dto.rs             # GuessResult DTO
└── infrastructure/
    ├── mod.rs
    ├── storage.rs         # GameRepository, AdminRepository
    └── external.rs        # GameHubGateway, VerifierGateway
```

## Flujo del Juego

```
1. start_game(session_id, word_setter, guesser, points...)
   └── Registra juego en Game Hub, crea estado inicial

2. commit_word(session_id, word_commitment)
   └── Word Setter compromete hash(palabra + salt)

3. guess(session_id, guess_letters)
   └── Guesser envía 5 letras [0-25]

4. resolve_guess(session_id, feedback, is_correct, proof, hash)
   └── Word Setter envía ZK proof del feedback
   └── Contrato verifica proof via wordle-verifier-adapter
   └── Si is_correct=true o guess_count=6, el juego termina
```

## Interfaz del Contrato

### Funciones de Juego

```rust
// Iniciar juego (requiere auth de ambos jugadores)
fn start_game(
    session_id: u32,
    word_setter: Address,
    guesser: Address,
    word_setter_points: i128,
    guesser_points: i128,
) -> Result<(), Error>;

// Word Setter compromete la palabra
fn commit_word(
    session_id: u32,
    word_commitment: BytesN<32>,
) -> Result<(), Error>;

// Guesser envía un intento
fn guess(
    session_id: u32,
    guess_letters: BytesN<5>,  // 5 letras, cada una 0-25
) -> Result<(), Error>;

// Word Setter resuelve con ZK proof
fn resolve_guess(
    session_id: u32,
    feedback: Vec<u32>,        // 5 valores: 0=absent, 1=present, 2=correct
    is_correct: bool,
    proof_payload: Bytes,
    public_inputs_hash: BytesN<32>,
) -> Result<GuessResult, Error>;
```

### Funciones de Consulta

```rust
fn get_game(session_id: u32) -> Game;
fn get_rules() -> GameRules;  // { word_length: 5, max_guesses: 6, alphabet_size: 26 }
```

### Funciones Admin

```rust
fn get_admin() -> Address;
fn set_admin(new_admin: Address);
fn get_game_hub() -> Address;
fn set_game_hub(new_hub: Address);
fn get_verifier() -> Address;
fn set_verifier(new_verifier: Address);
fn upgrade(new_wasm_hash: BytesN<32>);
```

## Modelo de Dominio

### Game (Aggregate)

```rust
pub struct Game {
    pub word_setter: Address,
    pub guesser: Address,
    pub word_setter_points: i128,
    pub guesser_points: i128,
    pub phase: GamePhase,
    pub word_commitment: Option<BytesN<32>>,
    pub pending_guess: Option<BytesN<5>>,
    pub guesses: Vec<BytesN<5>>,
    pub feedbacks: Vec<Vec<u32>>,
    pub guess_count: u32,
    pub winner: Option<Address>,
}

pub enum GamePhase {
    WaitingForWord,  // Esperando commit del word setter
    Playing,         // Juego activo
    Ended,           // Juego terminado
}
```

### Feedback

| Valor | Significado | Color |
|-------|-------------|-------|
| 0 | Absent - letra no está en la palabra | Gris |
| 1 | Present - letra está pero en otra posición | Amarillo |
| 2 | Correct - letra correcta en posición correcta | Verde |

## Errores

```rust
pub enum DomainError {
    GameNotFound = 1,
    GameAlreadyExists = 2,
    GameAlreadyEnded = 3,
    InvalidPhase = 4,
    NotPlayer = 5,
    NotWordSetter = 6,
    NotGuesser = 7,
    SelfPlayNotAllowed = 8,
    WordAlreadyCommitted = 9,
    WordNotCommitted = 10,
    InvalidLetterValue = 11,      // letra >= 26
    PendingGuessExists = 12,
    NoPendingGuess = 13,
    MaxGuessesReached = 14,
    InvalidFeedbackLength = 15,   // feedback.len() != 5
    InvalidFeedbackValue = 16,    // feedback value > 2
    InvalidPublicInputsHash = 17,
    InvalidProof = 18,
}
```

## Seguridad

- **Commit-Reveal**: La palabra solo existe como hash on-chain
- **ZK Verification**: El feedback es verificado criptográficamente
- **Auth**: Cada acción requiere autorización del jugador correspondiente
- **Anti-trampa**: El Word Setter no puede mentir sobre el feedback

## Tests

```bash
cargo test -p wordle
```

16 tests cubren:
- Flujo completo del juego
- Validación de permisos (solo word_setter/guesser pueden actuar)
- Validación de fases (no guess antes de commit, etc.)
- Condiciones de victoria (guesser wins, word_setter wins after 6 guesses)
- Rechazo de inputs inválidos (letras > 25, feedback inválido)
- Verificación de proof
