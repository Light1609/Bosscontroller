#!/usr/bin/env python3
from pathlib import Path

path = Path('citizens-stage3/build_overlay.sh')
text = path.read_text(encoding='utf-8')
old = '''CP="$BASE"
while IFS= read -r jar; do
  CP="$CP:$jar"
done < <(find "$DEPS" -maxdepth 1 -type f -name '*.jar' | sort)
'''
new = '''PAPER_JAR="$(find "$DEPS" -maxdepth 1 -type f -name 'paper-api-*.jar' | sort | head -n 1)"
test -n "$PAPER_JAR"

echo "Paper compile API: $PAPER_JAR"
for jar in "$BASE" "$DEPS"/*.jar; do
  if jar tf "$jar" 2>/dev/null | grep -qx 'org/bukkit/entity/EntityType.class'; then
    echo "EntityType provider present: $jar"
  fi
done

# Paper 26.1.2 must win over any old Bukkit/Spigot API pulled transitively
# by compile-only helper libraries such as Libby or Vault.
CP="$PAPER_JAR:$BASE"
while IFS= read -r jar; do
  if [ "$jar" = "$PAPER_JAR" ]; then
    continue
  fi
  CP="$CP:$jar"
done < <(find "$DEPS" -maxdepth 1 -type f -name '*.jar' | sort)
'''
count = text.count(old)
if count != 1:
    raise SystemExit(f'Expected one overlay classpath block, found {count}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('Forced Paper API ahead of transitive Bukkit/Spigot APIs in overlay classpath')
