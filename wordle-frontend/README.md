# Wordle Frontend (2D)

Frontend 2D para el juego Wordle on-chain. Palabra de 5 letras, 6 intentos, feedback verde/amarillo/gris.

## Concepto

- **Verde**: letra correcta en la posición correcta.
- **Amarillo**: letra correcta en otra posición.
- **Gris**: letra que no está en la palabra.

## Cómo correr

Desde la raíz del repo:

```bash
bun run dev:game wordle
```

O desde este directorio:

```bash
bun install
bun run dev
```

## Configuración on-chain

1. Despliega el contrato Wordle y obtén el ID (incluye wordle en el deploy del repo).
2. Genera bindings: `bun run build wordle && bun run bindings wordle`.
3. Copia el cliente generado en `bindings/wordle/src/index.ts` a `wordle-frontend/src/bindings.ts` (o integra el `Client` exportado en `createWordleClient`).
4. Configura en la raíz del repo en `.env`:
   - `VITE_WORDLE_CONTRACT_ID=<contract-id>`
   - `VITE_DEV_PLAYER1_ADDRESS` (y opcionalmente `VITE_DEV_PLAYER2_ADDRESS`) para las wallets de prueba.

El proof de `resolve_guess` se genera en el navegador (WASM + snarkjs), igual que en Battleship. Hace falta tener los circuitos compilados y el zkey: `bun run circuits:build` y el trusted setup para resolve_guess (ver abajo). En dev, Vite sirve `/circuits/build` desde el repo; en producción, se copian a `wordle-frontend/public/circuits/build`.

El contrato Wordle está en `contracts/wordle`; flujo: `start_game` → `commit_word` (word setter) → `guess` (guesser) → `resolve_guess` (word setter con ZK proof).

### Verifier y vkey para Wordle (resolve_guess)

Wordle usa un **Groth16 verifier distinto** al de Battleship (resolve_shot). El proof de `resolve_guess` debe verificarse con la verification key del circuito **resolve_guess**, no la de resolve_shot.

**Primera vez (trusted setup para resolve_guess):**

1. Compilar circuitos: `bun run circuits:build`
2. Generar vkey de Wordle (necesitas un archivo ptau; si no tienes: `npx snarkjs ptn bn128 12 circuits/build/ptau.ptau`):
   ```bash
   bun run circuits:setup-vkey-wordle -- --ptau circuits/build/ptau.ptau
   bun run circuits:vkey-to-soroban circuits/build/vkey_wordle.json --out circuits/build/vkey_wordle_soroban.json
   ```
3. Desplegar Wordle (incluye verifier con vkey de resolve_guess y adapter):
   ```bash
   bun run deploy wordle
   ```
   El script despliega: `circom-groth16-verifier` (instancia Wordle con vkey_wordle_soroban) → `wordle-verifier-adapter` → `wordle`.

Si el verifier de Wordle no está desplegado con la vkey de resolve_guess, `resolve_guess` fallará en el contrato con **Error(Contract, #1)** (verificación del proof).
