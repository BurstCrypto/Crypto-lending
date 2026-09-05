import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from 'node:fs';
import { isAbsolute, join, normalize, parse, relative, resolve } from 'node:path';

export class SecureLocalFileValidationError extends Error {
  constructor() {
    super('Controlled local file is unavailable or unsafe.');
    this.name = 'SecureLocalFileValidationError';
  }
}

function invalid() {
  throw new SecureLocalFileValidationError();
}

function hasUnsafeColon(value) {
  if (!value.includes(':')) return false;
  return !(
    process.platform === 'win32' &&
    /^[A-Za-z]:[\\/]/u.test(value) &&
    !value.slice(2).includes(':')
  );
}

function comparablePath(value) {
  let path = normalize(resolve(value));
  if (path.startsWith('\\\\?\\UNC\\')) path = `\\\\${path.slice(8)}`;
  else if (path.startsWith('\\\\?\\')) path = path.slice(4);
  path = path.replace(/[\\/]+$/u, '');
  return process.platform === 'win32' ? path.toLowerCase() : path;
}

function sameStableFile(left, right) {
  return (
    left.isFile() &&
    right.isFile() &&
    left.nlink === 1n &&
    right.nlink === 1n &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function assertCanonicalUnlinkedPath(absolutePath) {
  const root = parse(absolutePath).root;
  const childPath = relative(root, absolutePath);
  if (root.length === 0 || childPath === '' || isAbsolute(childPath)) invalid();
  let current = root;
  for (const component of childPath.split(/[\\/]+/u)) {
    if (component.length === 0) invalid();
    current = join(current, component);
    const status = lstatSync(current, { bigint: true });
    const final = comparablePath(current) === comparablePath(absolutePath);
    if (status.isSymbolicLink() || (!final && !status.isDirectory())) invalid();
    if (comparablePath(realpathSync.native(current)) !== comparablePath(current)) invalid();
  }
}

function readDescriptorExactly(descriptor, size) {
  const bytes = Buffer.allocUnsafe(size);
  let offset = 0;
  while (offset < size) {
    const count = readSync(descriptor, bytes, offset, size - offset, offset);
    if (count <= 0) invalid();
    offset += count;
  }
  const overflow = Buffer.allocUnsafe(1);
  if (readSync(descriptor, overflow, 0, 1, size) !== 0) invalid();
  return bytes;
}

function readSecureLocalFileInternal(filePath, maximumBytes, afterFirstReadForTest) {
  if (
    typeof filePath !== 'string' ||
    filePath.length === 0 ||
    filePath.length > 4_096 ||
    filePath.includes('\u0000') ||
    hasUnsafeColon(filePath) ||
    /^(?:\\\\|\/\/)/u.test(filePath) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(filePath) ||
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 1
  ) {
    return invalid();
  }
  const absolutePath = resolve(filePath);
  let descriptor;
  try {
    assertCanonicalUnlinkedPath(absolutePath);
    const before = lstatSync(absolutePath, { bigint: true });
    if (
      before.isSymbolicLink() ||
      !before.isFile() ||
      before.nlink !== 1n ||
      before.size <= 0n ||
      before.size > BigInt(maximumBytes)
    ) {
      return invalid();
    }
    const noFollow = process.platform === 'win32' ? 0 : (fsConstants.O_NOFOLLOW ?? 0);
    descriptor = openSync(absolutePath, fsConstants.O_RDONLY | noFollow);
    const opened = fstatSync(descriptor, { bigint: true });
    if (!sameStableFile(before, opened)) return invalid();
    const size = Number(opened.size);
    const first = readDescriptorExactly(descriptor, size);
    afterFirstReadForTest?.();
    const afterFirst = fstatSync(descriptor, { bigint: true });
    if (!sameStableFile(opened, afterFirst)) return invalid();
    const second = readDescriptorExactly(descriptor, size);
    const afterSecond = fstatSync(descriptor, { bigint: true });
    assertCanonicalUnlinkedPath(absolutePath);
    const finalPath = lstatSync(absolutePath, { bigint: true });
    if (
      !sameStableFile(opened, afterSecond) ||
      !sameStableFile(afterSecond, finalPath) ||
      !first.equals(second)
    ) {
      return invalid();
    }
    return first;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function readFixedError(filePath, maximumBytes, afterFirstReadForTest) {
  try {
    return readSecureLocalFileInternal(filePath, maximumBytes, afterFirstReadForTest);
  } catch {
    return invalid();
  }
}

export function readSecureLocalFile(filePath, maximumBytes) {
  return readFixedError(filePath, maximumBytes, undefined);
}

/** Test-only fault seam; production callers use readSecureLocalFile. */
export function readSecureLocalFileForTest(filePath, maximumBytes, afterFirstReadForTest) {
  return readFixedError(filePath, maximumBytes, afterFirstReadForTest);
}
