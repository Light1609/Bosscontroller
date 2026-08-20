#!/usr/bin/env python3
from pathlib import Path
import sys

root = Path(sys.argv[1])
hook = root / "main/src/main/java/net/citizensnpcs/PacketEventsHook.java"
text = hook.read_text(encoding="utf-8")
old = '''                int version = event.getUser().getPacketVersion().getProtocolVersion();

                HologramRenderer hr = npc.data().get(NPC.Metadata.HOLOGRAM_RENDERER);
                String suppliedName = hr.getPerPlayerText(npc, event.getPlayer());
                Object componentName = suppliedName == null
                        || version <= ServerVersion.V_1_12_2.getProtocolVersion()
                                ? null
                                : minimessage(suppliedName);
'''
new = '''                HologramRenderer hr = npc.data().get(NPC.Metadata.HOLOGRAM_RENDERER);
                String suppliedName = hr.getPerPlayerText(npc, event.getPlayer());
                Object componentName = suppliedName == null ? null : minimessage(suppliedName);
'''
if text.count(old) != 1:
    raise SystemExit(f"Expected exactly one modern component prelude, found {text.count(old)}")
text = text.replace(old, new, 1)

old2 = '''                    } else if (suppliedName != null && data.getIndex() == 2) {
                        if (version <= ServerVersion.V_1_12_2.getProtocolVersion()) {
                            if (EntityDataTypes.STRING.equals(data.getType())) {
                                ((EntityData) data).setValue(suppliedName);
                                delta = true;
                            }
                        } else if (componentName != null
                                && EntityDataTypes.OPTIONAL_ADV_COMPONENT.equals(data.getType())) {
                            ((EntityData) data).setValue(Optional.of(componentName));
                            delta = true;
                        }
                    }
'''
new2 = '''                    } else if (componentName != null && data.getIndex() == 2
                            && EntityDataTypes.OPTIONAL_ADV_COMPONENT.equals(data.getType())) {
                        ((EntityData) data).setValue(Optional.of(componentName));
                        delta = true;
                    }
'''
if text.count(old2) != 1:
    raise SystemExit(f"Expected exactly one legacy custom-name branch, found {text.count(old2)}")
text = text.replace(old2, new2, 1)

if "EntityDataTypes.STRING" in text:
    raise SystemExit("Legacy EntityDataTypes.STRING reference remains")

hook.write_text(text, encoding="utf-8")
print("Applied modern-only 26.1 metadata fix")
