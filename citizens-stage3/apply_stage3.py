#!/usr/bin/env python3
from pathlib import Path
import sys

root = Path(sys.argv[1])


def replace_once(path, old, new, label):
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match in {path}, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def replace_count(path, old, new, expected, label):
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != expected:
        raise RuntimeError(f"{label}: expected {expected} matches in {path}, found {count}")
    path.write_text(text.replace(old, new), encoding="utf-8")

citizens = root / "main/src/main/java/net/citizensnpcs/Citizens.java"
hook = root / "main/src/main/java/net/citizensnpcs/PacketEventsHook.java"
hologram = root / "main/src/main/java/net/citizensnpcs/trait/HologramTrait.java"

# ---------------------------------------------------------------------------
# Stage 1 - PacketEvents lifecycle is owned by the PacketEvents plugin.
# ---------------------------------------------------------------------------
replace_once(
    citizens,
    'import io.github.retrooper.packetevents.factory.spigot.SpigotPacketEventsBuilder;\n',
    '',
    'remove embedded PacketEvents builder import')

replace_once(
    citizens,
'''    @Override
    public void onDisable() {
        if (!enabled)
            return;

        Editor.leaveAll();
''',
'''    @Override
    public void onDisable() {
        if (packetEventsHook != null) {
            packetEventsHook.shutdown();
            packetEventsHook = null;
        }
        packetEventsEnabled = false;
        if (!enabled)
            return;

        Editor.leaveAll();
''',
    'PacketEvents hook shutdown before Citizens teardown')

replace_once(
    citizens,
'''        CitizensAPI.shutdown();
        if (packetEventsEnabled) {
            PacketEvents.getAPI().terminate();
        }
        scoreboardManager.close();
''',
'''        CitizensAPI.shutdown();
        scoreboardManager.close();
''',
    'do not terminate shared PacketEvents API')

replace_once(
    citizens,
'''    @Override
    public void onLoad() {
        if (SpigotUtil.isFoliaServer())
            // Packet rewriting cannot be supported on Folia, because to call entities,
            // it must be done on their thread, so there will be a 1-tick delay,
            // therefore it is not currently supported.
            return;

        try {
            PacketEvents.setAPI(SpigotPacketEventsBuilder.build(this));
            PacketEvents.getAPI().load();
            packetEventsEnabled = true;
        } catch (Throwable t) {
        }
    }
''',
'''    private boolean isPacketEventsAvailable() {
        if (SpigotUtil.isFoliaServer())
            return false;
        Plugin packetEvents = Bukkit.getPluginManager().getPlugin("packetevents");
        if (packetEvents == null || !packetEvents.isEnabled())
            return false;
        try {
            return PacketEvents.getAPI() != null;
        } catch (Throwable t) {
            return false;
        }
    }
''',
    'reuse external PacketEvents lifecycle')

replace_once(
    citizens,
'''        public void run() {
            if (packetEventsEnabled) {
                try {
                    packetEventsHook = new PacketEventsHook(Citizens.this);
                } catch (Throwable t) {
                    Messaging.severe("PacketEvents support not enabled due to following error:");
                    t.printStackTrace();
                }
            }
''',
'''        public void run() {
            packetEventsEnabled = isPacketEventsAvailable();
            if (packetEventsEnabled) {
                try {
                    packetEventsHook = new PacketEventsHook(Citizens.this);
                } catch (Throwable t) {
                    packetEventsEnabled = false;
                    Messaging.severe("PacketEvents support not enabled due to following error:");
                    t.printStackTrace();
                }
            }
''',
    'late PacketEvents availability detection')

replace_once(
    hook,
'''import com.github.retrooper.packetevents.event.PacketListener;
import com.github.retrooper.packetevents.event.PacketListenerPriority;
import com.github.retrooper.packetevents.event.PacketSendEvent;
''',
'''import com.github.retrooper.packetevents.event.EventManager;
import com.github.retrooper.packetevents.event.PacketListener;
import com.github.retrooper.packetevents.event.PacketListenerCommon;
import com.github.retrooper.packetevents.event.PacketListenerPriority;
import com.github.retrooper.packetevents.event.PacketSendEvent;
''',
    'PacketEvents listener handle imports')

replace_once(
    hook,
'''public class PacketEventsHook implements Listener {
    private MethodHandle DESERIALIZE_METHOD;
''',
'''public class PacketEventsHook implements Listener {
    private MethodHandle DESERIALIZE_METHOD;
    private final EventManager eventManager;
''',
    'EventManager field')

replace_once(
    hook,
'''    private Object MINIMESSAGE;
    private final Map<UUID, MirrorTrait> mirrorTraits = Maps.newConcurrentMap();
''',
'''    private Object MINIMESSAGE;
    private final List<PacketListenerCommon> packetListeners = new ArrayList<>();
    private final Map<UUID, MirrorTrait> mirrorTraits = Maps.newConcurrentMap();
''',
    'PacketEvents listener handle list')

replace_once(
    hook,
'''    public PacketEventsHook(Citizens plugin) {
        Bukkit.getPluginManager().registerEvents(this, plugin);
        PacketEvents.getAPI().init();
        PacketEvents.getAPI().getEventManager().registerListener(new PacketListener() {
''',
'''    public PacketEventsHook(Citizens plugin) {
        if (PacketEvents.getAPI() == null)
            throw new IllegalStateException("PacketEvents API is not available");
        eventManager = PacketEvents.getAPI().getEventManager();
        registerPacketListener(new PacketListener() {
''',
    'do not init PacketEvents from Citizens')

replace_count(
    hook,
    'PacketEvents.getAPI().getEventManager().registerListener(new PacketListener() {',
    'registerPacketListener(new PacketListener() {',
    4,
    'remaining PacketEvents listener registrations')

replace_once(
    hook,
'''        }, PacketListenerPriority.HIGHEST);
    }

    private Object minimessage(String raw) {
''',
'''        }, PacketListenerPriority.HIGHEST);
        Bukkit.getPluginManager().registerEvents(this, plugin);
    }

    private void registerPacketListener(PacketListener listener, PacketListenerPriority priority) {
        try {
            packetListeners.add(eventManager.registerListener(listener, priority));
        } catch (RuntimeException | Error ex) {
            shutdown();
            throw ex;
        }
    }

    public void shutdown() {
        if (packetListeners.isEmpty())
            return;
        eventManager.unregisterListeners(packetListeners.toArray(new PacketListenerCommon[0]));
        packetListeners.clear();
    }

    private Object minimessage(String raw) {
''',
    'register Bukkit listener last and add selective PacketEvents cleanup')

# ---------------------------------------------------------------------------
# Stage 2 - Never append a second serialization to an intercepted packet.
# PacketEvents performs the final serialization after all listeners finish.
# ---------------------------------------------------------------------------
replace_count(
    hook,
    'packet.write();',
    'event.markForReEncode(true);',
    12,
    'single-pass PacketEvents re-encode')

# ---------------------------------------------------------------------------
# Stage 3 - Type-safe hologram ENTITY_METADATA rewriting.
# ---------------------------------------------------------------------------
old_hologram_listener = '''                int version = event.getUser().getPacketVersion().getProtocolVersion();

                HologramRenderer hr = npc.data().get(NPC.Metadata.HOLOGRAM_RENDERER);
                Object fakeName = null;
                String suppliedName = hr.getPerPlayerText(npc, event.getPlayer());
                fakeName = version <= ServerVersion.V_1_12_2.getProtocolVersion() ? suppliedName
                        : Optional.of(minimessage(suppliedName));
                boolean sneaking = hr.isSneaking(npc, event.getPlayer());
                boolean delta = false;

                for (EntityData data : packet.getEntityMetadata()) {
                    if (sneaking && data.getIndex() == 0) {
                        byte b = (byte) (((Number) data.getValue()).byteValue() | 0x02);
                        data.setValue(b);
                        delta = true;
                    } else if (fakeName != null && data.getIndex() == 2) {
                        data.setValue(fakeName);
                        delta = true;
                    } else if (((data.getIndex() == 22 && version <= ServerVersion.V_1_19_4.getProtocolVersion())
                            || (data.getIndex() == 23 && version > ServerVersion.V_1_19_4.getProtocolVersion()))
                            && fakeName != null && npc.getEntity().getType() == EntityType.TEXT_DISPLAY) {
                        data.setValue(((Optional<?>) fakeName).get());
                        delta = true;
                    }
                }
                if (delta) {
                    event.markForReEncode(true);
                }
'''
new_hologram_listener = '''                int version = event.getUser().getPacketVersion().getProtocolVersion();

                HologramRenderer hr = npc.data().get(NPC.Metadata.HOLOGRAM_RENDERER);
                String suppliedName = hr.getPerPlayerText(npc, event.getPlayer());
                Object componentName = suppliedName == null
                        || version <= ServerVersion.V_1_12_2.getProtocolVersion()
                                ? null
                                : minimessage(suppliedName);
                boolean sneaking = hr.isSneaking(npc, event.getPlayer());
                boolean delta = false;
                EntityData<?> textDisplayText = null;

                // TextDisplay's visible text is a non-optional Component. Do not guess its
                // index: locate the unique ADV_COMPONENT field instead. This survives index
                // shifts in newer protocols and avoids writing a Component into another field.
                if (entity.getType() == EntityType.TEXT_DISPLAY && componentName != null) {
                    for (EntityData<?> data : packet.getEntityMetadata()) {
                        if (data.getIndex() == 2 || !EntityDataTypes.ADV_COMPONENT.equals(data.getType()))
                            continue;
                        if (textDisplayText != null) {
                            // Ambiguous metadata layout: fail closed rather than corrupting the packet.
                            textDisplayText = null;
                            break;
                        }
                        textDisplayText = data;
                    }
                }

                for (EntityData<?> data : packet.getEntityMetadata()) {
                    if (sneaking && data.getIndex() == 0 && EntityDataTypes.BYTE.equals(data.getType())
                            && data.getValue() instanceof Number) {
                        byte old = ((Number) data.getValue()).byteValue();
                        byte updated = (byte) (old | 0x02);
                        if (old != updated) {
                            ((EntityData) data).setValue(updated);
                            delta = true;
                        }
                    } else if (suppliedName != null && data.getIndex() == 2) {
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
                }
                if (textDisplayText != null) {
                    ((EntityData) textDisplayText).setValue(componentName);
                    delta = true;
                }
                if (delta) {
                    event.markForReEncode(true);
                }
'''
replace_once(hook, old_hologram_listener, new_hologram_listener,
             'type-safe hologram ENTITY_METADATA rewrite')

old_name_renderer = '''    private HologramRenderer createNameRenderer() {
        String setting = "armorstand_vehicle";
        HologramRenderer renderer = createRenderer(setting);
        if (renderer instanceof TextDisplayRenderer) {
            renderer = new TextDisplayVehicleRenderer((TextDisplayRenderer) renderer);
        }
        if (HologramRendererCreateEvent.handlers.getRegisteredListeners().length > 0) {
'''
new_name_renderer = '''    private HologramRenderer createNameRenderer() {
        HologramRenderer renderer;
        if (SUPPORTS_DISPLAY) {
            renderer = defaultRenderer instanceof TextDisplayRenderer
                    ? new TextDisplayVehicleRenderer((TextDisplayRenderer) defaultRenderer.copy())
                    : new TextDisplayVehicleRenderer();
        } else {
            renderer = new ArmorstandVehicleRenderer();
        }
        if (HologramRendererCreateEvent.handlers.getRegisteredListeners().length > 0) {
'''
replace_once(hologram, old_name_renderer, new_name_renderer,
             'name holograms use dedicated safe renderer')

# Guardrails: the exact dangerous lifecycle/write patterns must be gone.
checks = {
    citizens: [
        'SpigotPacketEventsBuilder',
        'PacketEvents.setAPI(',
        'PacketEvents.getAPI().load()',
        'PacketEvents.getAPI().terminate()',
    ],
    hook: [
        'PacketEvents.getAPI().init()',
        'packet.write();',
        'data.getIndex() == 23',
        'data.getIndex() == 22',
    ],
}
for path, forbidden in checks.items():
    text = path.read_text(encoding='utf-8')
    for token in forbidden:
        if token in text:
            raise RuntimeError(f"forbidden Stage3 pattern remains in {path}: {token}")

print('Stage 1-3 patch applied successfully')
