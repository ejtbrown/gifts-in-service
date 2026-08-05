import {
  createHash,
  createHmac,
  randomBytes,
  type BinaryLike,
} from "node:crypto";

// Cognito uses the 3072-bit RFC 5054 group and the device-specific SRP flow
// documented at https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-device-tracking.html.
// The encoding and HKDF details match the current AWS Amplify SRP helper.
const N = BigInt(
  "0x" +
    "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD1" +
    "29024E088A67CC74020BBEA63B139B22514A08798E3404DD" +
    "EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245" +
    "E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED" +
    "EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3D" +
    "C2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F" +
    "83655D23DCA3AD961C62F356208552BB9ED529077096966D" +
    "670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B" +
    "E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9" +
    "DE2BCBF6955817183995497CEA956AE515D2261898FA0510" +
    "15728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64" +
    "ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7" +
    "ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6B" +
    "F12FFA06D98A0864D87602733EC86A64521F2B18177B200C" +
    "BBE117577A615D6C770988C0BAD946E208E24FA074E5AB31" +
    "43DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF",
);
const G = 2n;
const DERIVED_KEY_INFO = Buffer.from("Caldera Derived Key\u0001", "utf8");

function sha256(input: BinaryLike): Buffer {
  return createHash("sha256").update(input).digest();
}

function positiveMod(value: bigint, modulus: bigint): bigint {
  const result = value % modulus;
  return result < 0n ? result + modulus : result;
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  if (modulus <= 0n || exponent < 0n)
    throw new Error("CognitoDeviceSrpParameterInvalid");
  let result = 1n;
  let factor = positiveMod(base, modulus);
  let remaining = exponent;
  while (remaining > 0n) {
    if ((remaining & 1n) === 1n) result = (result * factor) % modulus;
    remaining >>= 1n;
    factor = (factor * factor) % modulus;
  }
  return result;
}

function paddedHex(value: bigint): string {
  if (value < 0n) throw new Error("CognitoDeviceSrpParameterInvalid");
  let result = value.toString(16);
  if (result.length % 2 !== 0) result = `0${result}`;
  if (/^[89a-f]/iu.test(result)) result = `00${result}`;
  return result;
}

function bytesFromHex(value: string): Buffer {
  if (!/^(?:[a-f\d]{2})+$/iu.test(value))
    throw new Error("CognitoDeviceSrpHexInvalid");
  return Buffer.from(value, "hex");
}

function bigintFromHashOfHex(value: string): bigint {
  return BigInt(`0x${sha256(bytesFromHex(value)).toString("hex")}`);
}

type RandomBytesSource = (size: number) => Buffer;

function bigintFromRandom(bytes: number, source: RandomBytesSource): bigint {
  const value = BigInt(`0x${source(bytes).toString("hex")}`);
  return value === 0n ? 1n : value;
}

export interface CognitoDeviceCredentials {
  deviceKey: string;
  deviceGroupKey: string;
  deviceSecret: string;
}

export interface CognitoDeviceVerifier extends CognitoDeviceCredentials {
  salt: string;
  passwordVerifier: string;
}

export function createCognitoDeviceVerifier(
  deviceGroupKey: string,
  deviceKey: string,
  randomSource: RandomBytesSource = randomBytes,
): CognitoDeviceVerifier {
  if (!deviceGroupKey || !deviceKey)
    throw new Error("CognitoDeviceMetadataInvalid");
  const deviceSecret = randomSource(40).toString("base64");
  const saltHex = paddedHex(bigintFromRandom(16, randomSource));
  const secretHash = sha256(
    `${deviceGroupKey}${deviceKey}:${deviceSecret}`,
  ).toString("hex");
  const exponent = bigintFromHashOfHex(`${saltHex}${secretHash}`);
  const verifierHex = paddedHex(modPow(G, exponent, N));
  return {
    deviceKey,
    deviceGroupKey,
    deviceSecret,
    salt: bytesFromHex(saltHex).toString("base64"),
    passwordVerifier: bytesFromHex(verifierHex).toString("base64"),
  };
}

function cognitoTimestamp(now: Date): string {
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const time = [now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds()]
    .map((value) => value.toString().padStart(2, "0"))
    .join(":");
  return `${weekdays[now.getUTCDay()]} ${months[now.getUTCMonth()]} ${now.getUTCDate()} ${time} UTC ${now.getUTCFullYear()}`;
}

export interface CognitoDeviceSrpSession {
  publicA: string;
  answer(input: {
    serverB: string;
    salt: string;
    secretBlock: string;
    now?: Date;
  }): {
    passwordClaimSignature: string;
    passwordClaimSecretBlock: string;
    timestamp: string;
  };
}

export function createCognitoDeviceSrpSession(
  credentials: CognitoDeviceCredentials,
  randomSource: RandomBytesSource = randomBytes,
): CognitoDeviceSrpSession {
  const privateA = bigintFromRandom(128, randomSource);
  const publicA = modPow(G, privateA, N);
  if (publicA % N === 0n) throw new Error("CognitoDeviceSrpPublicValueInvalid");
  const multiplier = bigintFromHashOfHex(`${paddedHex(N)}${paddedHex(G)}`);

  return {
    publicA: publicA.toString(16),
    answer(input) {
      if (
        !/^[a-f\d]+$/iu.test(input.serverB) ||
        !/^[a-f\d]+$/iu.test(input.salt)
      )
        throw new Error("CognitoDeviceSrpChallengeInvalid");
      const serverB = BigInt(`0x${input.serverB}`);
      const salt = BigInt(`0x${input.salt}`);
      if (serverB % N === 0n)
        throw new Error("CognitoDeviceSrpServerValueInvalid");
      const scrambling = bigintFromHashOfHex(
        `${paddedHex(publicA)}${paddedHex(serverB)}`,
      );
      if (scrambling === 0n)
        throw new Error("CognitoDeviceSrpScramblingInvalid");
      const secretHash = sha256(
        `${credentials.deviceGroupKey}${credentials.deviceKey}:${credentials.deviceSecret}`,
      ).toString("hex");
      const privateKey = bigintFromHashOfHex(`${paddedHex(salt)}${secretHash}`);
      const sharedSecret = modPow(
        serverB - multiplier * modPow(G, privateKey, N),
        privateA + scrambling * privateKey,
        N,
      );
      const pseudoRandomKey = createHmac(
        "sha256",
        bytesFromHex(paddedHex(scrambling)),
      )
        .update(bytesFromHex(paddedHex(sharedSecret)))
        .digest();
      const derivedKey = createHmac("sha256", pseudoRandomKey)
        .update(DERIVED_KEY_INFO)
        .digest()
        .subarray(0, 16);
      const timestamp = cognitoTimestamp(input.now ?? new Date());
      const signature = createHmac("sha256", derivedKey)
        .update(credentials.deviceGroupKey, "utf8")
        .update(credentials.deviceKey, "utf8")
        .update(Buffer.from(input.secretBlock, "base64"))
        .update(timestamp, "utf8")
        .digest("base64");
      return {
        passwordClaimSignature: signature,
        passwordClaimSecretBlock: input.secretBlock,
        timestamp,
      };
    },
  };
}
