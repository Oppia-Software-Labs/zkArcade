/**
 * ESM wrapper around circom-generated board_commit witness calculator.
 * Pass the board_commit.wasm buffer to create a WitnessCalculator instance.
 * Used by proofService to compute board commitment via WASM.
 */
export default async function buildBoardCommitWitnessCalculator(code, options = {}) {
  const wasmModule = await WebAssembly.compile(code);
  let errStr = "";
  let msgStr = "";

  const instance = await WebAssembly.instantiate(wasmModule, {
    runtime: {
      exceptionHandler(code) {
        const messages = {
          1: "Signal not found.\n",
          2: "Too many signals set.\n",
          3: "Signal already set.\n",
          4: "Assert Failed.\n",
          5: "Not enough memory.\n",
          6: "Input signal array access exceeds the size.\n",
        };
        throw new Error((messages[code] || "Unknown error.\n") + errStr);
      },
      printErrorMessage() {
        errStr += getMessage() + "\n";
      },
      writeBufferMessage() {
        const msg = getMessage();
        if (msg === "\n") {
          console.log(msgStr);
          msgStr = "";
        } else {
          msgStr = msgStr ? msgStr + " " + msg : msg;
        }
      },
      showSharedRWMemory() {
        printSharedRWMemory();
      },
    },
  });

  function getMessage() {
    let message = "";
    let c = instance.exports.getMessageChar();
    while (c !== 0) {
      message += String.fromCharCode(c);
      c = instance.exports.getMessageChar();
    }
    return message;
  }

  function printSharedRWMemory() {
    const shared_rw_memory_size = instance.exports.getFieldNumLen32();
    const arr = new Uint32Array(shared_rw_memory_size);
    for (let j = 0; j < shared_rw_memory_size; j++) {
      arr[shared_rw_memory_size - 1 - j] = instance.exports.readSharedRWMemory(j);
    }
    if (msgStr !== "") msgStr += " ";
    msgStr += fromArray32(arr).toString();
  }

  const sanityCheck = options.sanityCheck ?? false;

  function toArray32(rem, size) {
    const res = [];
    const radix = BigInt(0x100000000);
    while (rem) {
      res.unshift(Number(rem % radix));
      rem = rem / radix;
    }
    if (size) {
      let i = size - res.length;
      while (i > 0) {
        res.unshift(0);
        i--;
      }
    }
    return res;
  }

  function fromArray32(arr) {
    let res = BigInt(0);
    const radix = BigInt(0x100000000);
    for (let i = 0; i < arr.length; i++) {
      res = res * radix + BigInt(arr[i]);
    }
    return res;
  }

  function flatArray(a) {
    const res = [];
    function fillArray(r, x) {
      if (Array.isArray(x)) {
        for (let i = 0; i < x.length; i++) fillArray(r, x[i]);
      } else {
        r.push(x);
      }
    }
    fillArray(res, a);
    return res;
  }

  function normalize(n, prime) {
    let res = BigInt(n) % prime;
    if (res < 0) res += prime;
    return res;
  }

  function fnvHash(str) {
    const uint64_max = BigInt(2) ** BigInt(64);
    let hash = BigInt("0xCBF29CE484222325");
    for (let i = 0; i < str.length; i++) {
      hash ^= BigInt(str.charCodeAt(i));
      hash *= BigInt(0x100000001b3);
      hash %= uint64_max;
    }
    let shash = hash.toString(16);
    shash = "0".repeat(16 - shash.length) + shash;
    return shash;
  }

  function qualify_input_list(prefix, input, input1) {
    if (Array.isArray(input)) {
      for (let i = 0; i < input.length; i++) {
        qualify_input_list(prefix + "[" + i + "]", input[i], input1);
      }
    } else {
      qualify_input(prefix, input, input1);
    }
  }

  function qualify_input(prefix, input, input1) {
    if (Array.isArray(input)) {
      const a = flatArray(input);
      if (a.length > 0) {
        const t = typeof a[0];
        for (let i = 1; i < a.length; i++) {
          if (typeof a[i] !== t) throw new Error(`Types differ in key ${prefix}`);
        }
        if (t === "object") qualify_input_list(prefix, input, input1);
        else input1[prefix] = input;
      }
    } else if (typeof input === "object" && input !== null) {
      for (const k of Object.keys(input)) {
        qualify_input(prefix ? prefix + "." + k : k, input[k], input1);
      }
    } else {
      input1[prefix] = input;
    }
  }

  class WitnessCalculator {
    constructor(inst, sanityCheck) {
      this.instance = inst;
      this.n32 = this.instance.exports.getFieldNumLen32();
      this.instance.exports.getRawPrime();
      const arr = new Uint32Array(this.n32);
      for (let i = 0; i < this.n32; i++) {
        arr[this.n32 - 1 - i] = this.instance.exports.readSharedRWMemory(i);
      }
      this.prime = fromArray32(arr);
      this.witnessSize = this.instance.exports.getWitnessSize();
      this.sanityCheck = sanityCheck;
    }

    async _doCalculateWitness(input_orig, sanityCheck) {
      this.instance.exports.init((this.sanityCheck || sanityCheck) ? 1 : 0);
      const input = {};
      qualify_input("", input_orig, input);
      const keys = Object.keys(input);
      let input_counter = 0;
      for (const k of keys) {
        const h = fnvHash(k);
        const hMSB = parseInt(h.slice(0, 8), 16);
        const hLSB = parseInt(h.slice(8, 16), 16);
        const fArr = flatArray(input[k]);
        const signalSize = this.instance.exports.getInputSignalSize(hMSB, hLSB);
        if (signalSize < 0) throw new Error(`Signal ${k} not found`);
        if (fArr.length < signalSize) throw new Error(`Not enough values for ${k}`);
        if (fArr.length > signalSize) throw new Error(`Too many values for ${k}`);
        for (let i = 0; i < fArr.length; i++) {
          const arrFr = toArray32(normalize(fArr[i], this.prime), this.n32);
          for (let j = 0; j < this.n32; j++) {
            this.instance.exports.writeSharedRWMemory(j, arrFr[this.n32 - 1 - j]);
          }
          this.instance.exports.setInputSignal(hMSB, hLSB, i);
          input_counter++;
        }
      }
      if (input_counter < this.instance.exports.getInputSize()) {
        throw new Error(`Not all inputs set: ${input_counter} / ${this.instance.exports.getInputSize()}`);
      }
    }

    async calculateWitness(input, sanityCheck) {
      const w = [];
      await this._doCalculateWitness(input, sanityCheck);
      for (let i = 0; i < this.witnessSize; i++) {
        this.instance.exports.getWitness(i);
        const arr = new Uint32Array(this.n32);
        for (let j = 0; j < this.n32; j++) {
          arr[this.n32 - 1 - j] = this.instance.exports.readSharedRWMemory(j);
        }
        w.push(fromArray32(arr));
      }
      return w;
    }
  }

  return new WitnessCalculator(instance, sanityCheck);
}
