#!/usr/bin/env python3
from pathlib import Path

path = Path('citizens-stage3/build_overlay.sh')
text = path.read_text(encoding='utf-8')

old_repo = '''    <repository>
      <id>codemc-releases</id>
      <url>https://repo.codemc.io/repository/maven-releases/</url>
    </repository>
'''
new_repo = old_repo + '''    <repository>
      <id>placeholderapi</id>
      <url>https://repo.extendedclip.com/content/repositories/placeholderapi/</url>
    </repository>
'''
if text.count(old_repo) != 1:
    raise SystemExit(f'Expected one CodeMC repository block, found {text.count(old_repo)}')
text = text.replace(old_repo, new_repo, 1)

anchor = '''    <dependency>
      <groupId>com.github.retrooper</groupId>
      <artifactId>packetevents-spigot</artifactId>
      <version>2.12.1</version>
    </dependency>
'''
insert = anchor + '''    <dependency>
      <groupId>me.clip</groupId>
      <artifactId>placeholderapi</artifactId>
      <version>2.11.5</version>
    </dependency>
'''
if text.count(anchor) != 1:
    raise SystemExit(f'Expected one PacketEvents dependency anchor, found {text.count(anchor)}')
text = text.replace(anchor, insert, 1)

path.write_text(text, encoding='utf-8')
print('Added PlaceholderAPI 2.11.5 compile dependency from Citizens b4232 upstream POM')
