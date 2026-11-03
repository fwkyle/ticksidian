import {
  randomBytes,
  scrypt as scryptCb,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

/**
 * 비밀번호 해싱 / 검증.
 *
 * 왜 scrypt인가:
 *  - Node 빌트인이라 native dep 컴파일 실패 위험이 없다 (bcrypt/argon2 회피).
 *  - 단방향 KDF로 password 평문을 절대 복원할 수 없다.
 *  - dev 단계 자원 소비도 충분히 작다.
 *
 * 저장 포맷: `scrypt$N$r$p$saltHex$hashHex`
 * 비교는 `timingSafeEqual`로 timing attack 방어.
 */

interface ScryptOptions {
  N: number;
  r: number;
  p: number;
}

function scrypt(
  password: string,
  salt: Buffer,
  keyLen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keyLen, options, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
}

// scrypt 표준 권장값 (RFC 7914 + Node 기본 메모리 한도 fits).
const N = 16384;
const r = 8;
const p = 1;
const KEY_LEN = 64;
const SALT_LEN = 16;

const PREFIX = "scrypt";

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const derived = await scrypt(plain, salt, KEY_LEN, { N, r, p });
  return [
    PREFIX,
    String(N),
    String(r),
    String(p),
    salt.toString("hex"),
    derived.toString("hex"),
  ].join("$");
}

/**
 * 가짜 hash 상수 (TICK-P0-004 timing attack 완화).
 *
 * 없는 이메일로 로그인 시도가 들어오면 server는 실제 verify 흐름을 한 번 돌아
 * "사용자 미존재"와 "비밀번호 불일치"의 응답 시간을 동일하게 맞춘다. 이때 사용하는
 * dummy hash가 실제 scrypt cost와 일치해야 의미가 있다.
 *
 * 이전에는 `scrypt$1$1$1$00$00` 같은 malformed 값을 넣었는데, `verifyPassword`가
 * salt/hash 길이 0을 검출해 즉시 false로 반환해 cost를 거치지 않았다. 그래서 모듈
 * 로드 시 1회만 표준 파라미터(N=16384, r=8, p=1)로 정상 hash를 만들어 상수로 둔다.
 *
 * scryptSync는 동기적으로 main thread를 블로킹하지만 서버 부팅 시 단 1회 호출이라
 * `server.listen()` 전에 끝난다. 평문은 보존하지 않는다 (계산 직후 GC 대상).
 */
const DUMMY_PASSWORD_PLAIN = "ticksidian-dummy-not-a-real-password";
const DUMMY_SALT = randomBytes(SALT_LEN);
const DUMMY_DERIVED = scryptSync(DUMMY_PASSWORD_PLAIN, DUMMY_SALT, KEY_LEN, {
  N,
  r,
  p,
});
export const DUMMY_PASSWORD_HASH: string = [
  PREFIX,
  String(N),
  String(r),
  String(p),
  DUMMY_SALT.toString("hex"),
  DUMMY_DERIVED.toString("hex"),
].join("$");

/** false on any malformed input or mismatch. Never throws on bad input. */
export async function verifyPassword(
  plain: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6) return false;
  const [prefix, nStr, rStr, pStr, saltHex, hashHex] = parts;
  if (prefix !== PREFIX) return false;
  const nUsed = Number(nStr);
  const rUsed = Number(rStr);
  const pUsed = Number(pStr);
  if (!Number.isFinite(nUsed) || !Number.isFinite(rUsed) || !Number.isFinite(pUsed)) {
    return false;
  }
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  if (salt.length === 0 || expected.length === 0) return false;
  let derived: Buffer;
  try {
    derived = await scrypt(plain, salt, expected.length, {
      N: nUsed,
      r: rUsed,
      p: pUsed,
    });
  } catch {
    return false;
  }
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
