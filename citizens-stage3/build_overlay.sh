#!/usr/bin/env bash
set -euo pipefail

ROOT="${GITHUB_WORKSPACE:-$(pwd)}"
SRC="$ROOT/citizens-src"
BASE="$ROOT/citizens-stage3/base/Citizens-2.0.43-b4232.jar"
WORK="$ROOT/citizens-stage3/overlay-work"
DEPS="$WORK/deps"
CLASSES="$WORK/classes"
BUILD="$ROOT/citizens-stage3/build"
OUT="$BUILD/Citizens-2.0.43-b4232-FRESITA-STAGE3.jar"

rm -rf "$WORK" "$BUILD"
mkdir -p "$DEPS" "$CLASSES" "$BUILD"

test -f "$BASE"
test "$(stat -c '%s' "$BASE")" = '4367892'

cat > "$WORK/pom.xml" <<'POM'
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>dev.fresita</groupId>
  <artifactId>citizens-stage3-overlay-compile-deps</artifactId>
  <version>1.0.0</version>
  <repositories>
    <repository>
      <id>papermc</id>
      <url>https://repo.papermc.io/repository/maven-public/</url>
    </repository>
    <repository>
      <id>codemc-releases</id>
      <url>https://repo.codemc.io/repository/maven-releases/</url>
    </repository>
    <repository>
      <id>jitpack</id>
      <url>https://jitpack.io</url>
    </repository>
  </repositories>
  <dependencies>
    <dependency>
      <groupId>io.papermc.paper</groupId>
      <artifactId>paper-api</artifactId>
      <version>26.1.2.build.74-stable</version>
    </dependency>
    <dependency>
      <groupId>com.github.retrooper</groupId>
      <artifactId>packetevents-spigot</artifactId>
      <version>2.12.1</version>
    </dependency>
    <dependency>
      <groupId>net.byteflux</groupId>
      <artifactId>libby-bukkit</artifactId>
      <version>1.1.5</version>
    </dependency>
    <dependency>
      <groupId>ch.ethz.globis.phtree</groupId>
      <artifactId>phtree</artifactId>
      <version>2.8.2</version>
    </dependency>
    <dependency>
      <groupId>com.github.MilkBowl</groupId>
      <artifactId>VaultAPI</artifactId>
      <version>1.7</version>
    </dependency>
    <dependency>
      <groupId>org.joml</groupId>
      <artifactId>joml</artifactId>
      <version>1.10.9</version>
    </dependency>
    <dependency>
      <groupId>com.google.guava</groupId>
      <artifactId>guava</artifactId>
      <version>33.4.8-jre</version>
    </dependency>
  </dependencies>
</project>
POM

mvn -q -f "$WORK/pom.xml" dependency:copy-dependencies \
  -DincludeScope=compile \
  -DoutputDirectory="$DEPS"

AUTHLIB="$DEPS/authlib-7.0.63.jar"
curl --fail --location --retry 3 --retry-delay 2 \
  'https://libraries.minecraft.net/com/mojang/authlib/7.0.63/authlib-7.0.63.jar' \
  -o "$AUTHLIB"
echo "54895b4e25e8b9b4cbbbe25f24eccf2b71b1ac2b  $AUTHLIB" | sha1sum -c -

CP="$BASE"
while IFS= read -r jar; do
  CP="$CP:$jar"
done < <(find "$DEPS" -maxdepth 1 -type f -name '*.jar' | sort)

CITIZENS="$SRC/main/src/main/java/net/citizensnpcs/Citizens.java"
HOOK="$SRC/main/src/main/java/net/citizensnpcs/PacketEventsHook.java"
HOLOGRAM="$SRC/main/src/main/java/net/citizensnpcs/trait/HologramTrait.java"

javac \
  -source 8 \
  -target 8 \
  -Xlint:-options \
  -proc:none \
  -encoding UTF-8 \
  -classpath "$CP" \
  -d "$CLASSES" \
  "$CITIZENS" "$HOOK" "$HOLOGRAM"

python3 - <<'PY'
from pathlib import Path
from zipfile import ZipFile

root = Path(__import__('os').environ.get('GITHUB_WORKSPACE', '.')).resolve()
base = root / 'citizens-stage3/base/Citizens-2.0.43-b4232.jar'
classes = root / 'citizens-stage3/overlay-work/classes'
build = root / 'citizens-stage3/build'

families = [
    ('net/citizensnpcs', 'Citizens'),
    ('net/citizensnpcs', 'PacketEventsHook'),
    ('net/citizensnpcs/trait', 'HologramTrait'),
]

compiled = []
for parent_rel, stem in families:
    parent = classes / parent_rel
    compiled.extend(
        p.relative_to(classes).as_posix()
        for p in parent.glob(stem + '*.class')
        if p.name == stem + '.class' or p.name.startswith(stem + '$')
    )
compiled = sorted(set(compiled))
if not compiled:
    raise SystemExit('No compiled Stage3 classes found')

with ZipFile(base) as z:
    baseline = set(z.namelist())

def targeted(name):
    return any(
        name == f'{parent}/{stem}.class' or name.startswith(f'{parent}/{stem}$')
        for parent, stem in families
    ) and name.endswith('.class')

baseline_target = sorted(n for n in baseline if targeted(n))
if compiled != baseline_target:
    raise SystemExit(
        'Stage3 class family mismatch. '
        f'Missing={sorted(set(baseline_target)-set(compiled))} '
        f'Extra={sorted(set(compiled)-set(baseline_target))}'
    )

for top in [
    'net/citizensnpcs/Citizens.class',
    'net/citizensnpcs/PacketEventsHook.class',
    'net/citizensnpcs/trait/HologramTrait.class',
]:
    data = (classes / top).read_bytes()
    if data[:4] != b'\xca\xfe\xba\xbe':
        raise SystemExit(f'Invalid class file: {top}')
    major = int.from_bytes(data[6:8], 'big')
    if major != 52:
        raise SystemExit(f'Unexpected Java class major for {top}: {major}, expected 52')

(build / 'replacements.txt').write_text('\n'.join(compiled) + '\n')
print(f'Compiled and matched {len(compiled)} exact Stage3 class entries')
PY

cp "$BASE" "$OUT"
while IFS= read -r classfile; do
  zip -q -d "$OUT" "$classfile"
done < "$BUILD/replacements.txt"

pushd "$CLASSES" >/dev/null
while IFS= read -r classfile; do
  jar uf "$OUT" "$classfile"
done < "$BUILD/replacements.txt"
popd >/dev/null

python3 - <<'PY'
import hashlib
import os
from pathlib import Path
from zipfile import ZipFile

root = Path(os.environ.get('GITHUB_WORKSPACE', '.')).resolve()
base = root / 'citizens-stage3/base/Citizens-2.0.43-b4232.jar'
out = root / 'citizens-stage3/build/Citizens-2.0.43-b4232-FRESITA-STAGE3.jar'
replacements = set((root / 'citizens-stage3/build/replacements.txt').read_text().splitlines())

def hashes(path):
    result = {}
    with ZipFile(path) as z:
        for info in z.infolist():
            if info.is_dir():
                continue
            if info.filename in result:
                raise SystemExit(f'Duplicate ZIP entry in {path}: {info.filename}')
            result[info.filename] = hashlib.sha256(z.read(info.filename)).hexdigest()
    return result

a = hashes(base)
b = hashes(out)
if set(a) != set(b):
    raise SystemExit(
        f'JAR entry set changed: removed={sorted(set(a)-set(b))} added={sorted(set(b)-set(a))}'
    )

unexpected = [n for n in a if n not in replacements and a[n] != b[n]]
if unexpected:
    raise SystemExit('Non-Stage3 contents changed: ' + ', '.join(unexpected[:20]))

for top in [
    'net/citizensnpcs/Citizens.class',
    'net/citizensnpcs/PacketEventsHook.class',
    'net/citizensnpcs/trait/HologramTrait.class',
]:
    if a[top] == b[top]:
        raise SystemExit(f'Patched top-level class did not change: {top}')

nms = [n for n in a if n.startswith('net/citizensnpcs/nms/v26_1_R1/')]
if not nms:
    raise SystemExit('No v26_1_R1 entries found')
if any(a[n] != b[n] for n in nms):
    raise SystemExit('v26_1_R1 NMS content changed')

changed = sorted(n for n in replacements if a[n] != b[n])
(root / 'citizens-stage3/build/changed-classes.txt').write_text('\n'.join(changed) + '\n')
print(
    f'Overlay verified: {len(changed)}/{len(replacements)} Stage3 class entries changed; '
    f'{len(nms)} v26_1_R1 entries byte-identical; all non-Stage3 content byte-identical'
)
PY

zip -T "$OUT"

javap -classpath "$OUT:$CP" -p -c net.citizensnpcs.Citizens > "$BUILD/Citizens.javap.txt"
javap -classpath "$OUT:$CP" -p -c net.citizensnpcs.PacketEventsHook > "$BUILD/PacketEventsHook.javap.txt"
javap -classpath "$OUT:$CP" -p -c net.citizensnpcs.trait.HologramTrait > "$BUILD/HologramTrait.javap.txt"

if grep -Eq 'SpigotPacketEventsBuilder|PacketEvents\.setAPI|PacketEvents.*terminate' "$BUILD/Citizens.javap.txt"; then
  echo 'Forbidden PacketEvents ownership bytecode remains in Citizens'
  exit 1
fi
grep -q 'isPacketEventsAvailable' "$BUILD/Citizens.javap.txt"
grep -q 'PacketEventsHook.shutdown' "$BUILD/Citizens.javap.txt"

if grep -Eq 'PacketEvents.*\.init:|\.write:\(\)V' "$BUILD/PacketEventsHook.javap.txt"; then
  echo 'Forbidden PacketEvents init/direct packet write bytecode remains in PacketEventsHook'
  exit 1
fi
grep -q 'unregisterListeners' "$BUILD/PacketEventsHook.javap.txt"
grep -q 'markForReEncode' "$BUILD/PacketEventsHook.javap.txt"
grep -q 'ADV_COMPONENT' "$BUILD/PacketEventsHook.javap.txt"
grep -q 'OPTIONAL_ADV_COMPONENT' "$BUILD/PacketEventsHook.javap.txt"
if grep -q 'EntityDataTypes.STRING' "$BUILD/PacketEventsHook.javap.txt"; then
  echo 'Legacy EntityDataTypes.STRING bytecode remains'
  exit 1
fi

grep -q 'TextDisplayVehicleRenderer' "$BUILD/HologramTrait.javap.txt"

unzip -p "$OUT" plugin.yml | grep -E '^name:|^version:'
sha256sum "$BASE" | tee "$BUILD/SHA256-OFFICIAL.txt"
sha256sum "$OUT" | tee "$BUILD/SHA256.txt"

echo 'Citizens Stage3 overlay build and verification completed successfully'
