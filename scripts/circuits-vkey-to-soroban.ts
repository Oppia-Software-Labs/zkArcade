#!/usr/bin/env bun

/**
 * Convert snarkjs vkey.json to VerificationKeyBytes JSON for the Soroban
 * circom-groth16-verifier contract.
 *
 * Snarkjs format uses vk_alpha_1, vk_beta_2, vk_gamma_2, vk_delta_2, IC.
 * VerificationKeyBytes expects alpha, beta, gamma, delta, ic as hex strings
 * (G1: 64 hex chars per point, G2: 128 hex chars; same encoding as
 * stellar-private-payments deploy.sh conversion).
 *
 * Usage:
 *   bun run scripts/circuits-vkey-to-soroban.ts [vkey.json] [--out vk_soroban.json]
 *   Default input: circuits/build/vkey.json
 *   Default output: circuits/build/vkey_soroban.json
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const ROOT = import.meta.dir + "/..";
const DEFAULT_IN = join(ROOT, "circuits", "build", "vkey.json");
const DEFAULT_OUT = join(ROOT, "circuits", "build", "vkey_soroban.json");

type SnarkjsVkey = {
  vk_alpha_1: [string, string];
  vk_beta_2: [string, string][] | [[string, string], [string, string]];
  vk_gamma_2: [string, string][] | [[string, string], [string, string]];
  vk_delta_2: [string, string][] | [[string, string], [string, string]];
  IC: [string, string][];
};

type VerificationKeyBytes = {
  alpha: string;
  beta: string;
  gamma: string;
  delta: string;
  ic: string[];
};

function toHex32(n: string | number): string {
  const v = typeof n === "string" ? BigInt(n) : BigInt(String(n));
  const buf = Buffer.alloc(32);
  buf.writeBigUInt64BE(v >> 192n, 0);
  buf.writeBigUInt64BE((v >> 128n) & 0xffffffffffffffffn, 8);
  buf.writeBigUInt64BE((v >> 64n) & 0xffffffffffffffffn, 16);
  buf.writeBigUInt64BE(v & 0xffffffffffffffffn, 24);
  return buf.toString("hex");
}

function g1Bytes(pt: [string, string]): string {
  return toHex32(pt[0]) + toHex32(pt[1]);
}

function g2Bytes(pt: [[string, string], [string, string]]): string {
  const [x_im, x_re] = pt[0];
  const [y_im, y_re] = pt[1];
  return toHex32(x_im) + toHex32(x_re) + toHex32(y_im) + toHex32(y_re);
}

function convert(data: SnarkjsVkey): VerificationKeyBytes {
  return {
    alpha: g1Bytes(data.vk_alpha_1),
    beta: g2Bytes(data.vk_beta_2 as [[string, string], [string, string]]),
    gamma: g2Bytes(data.vk_gamma_2 as [[string, string], [string, string]]),
    delta: g2Bytes(data.vk_delta_2 as [[string, string], [string, string]]),
    ic: data.IC.map((p) => g1Bytes(p)),
  };
}

function main() {
  const args = process.argv.slice(2);
  let inputPath = DEFAULT_IN;
  let outputPath = DEFAULT_OUT;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out" && args[i + 1]) {
      outputPath = args[++i];
    } else if (!args[i].startsWith("--")) {
      inputPath = args[i];
    }
  }

  const raw = readFileSync(inputPath, "utf-8");
  const data = JSON.parse(raw) as SnarkjsVkey;

  if (
    !data.vk_alpha_1 ||
    !data.vk_beta_2 ||
    !data.vk_gamma_2 ||
    !data.vk_delta_2 ||
    !Array.isArray(data.IC)
  ) {
    console.error("Invalid snarkjs vkey: expected vk_alpha_1, vk_beta_2, vk_gamma_2, vk_delta_2, IC");
    process.exit(1);
  }

  const out = convert(data);
  writeFileSync(outputPath, JSON.stringify(out, null, 2));
  console.log("Wrote", outputPath);
}

main();
