// =====================================================
// CUSTOM NPCS BOSS COMBAT CONTROLLER - PRIME VERSION
// Armourer's Workshop Animation System
// MC 1.21.1 / CustomNPCs Unofficial
// API compatible 1.18.2
// =====================================================

var CONFIG = {
    DEBUG: false,

    ANIM_TARGET_SELECTOR: "@s",
    ANIM_COMMAND_BASE: "/armourers animation entity {target} play {anim}",

    RUN: "run",
    IDLE: "idle",
    ATTACK_1: "attack1",
    ATTACK_2: "attack2",
    ATTACK_3: "attack3",
    ATTACK_4: "attack4",
    DEATH: "death",

    AGGRO_RANGE: 16,

    MELEE_RANGE: 3.2,
    MELEE_MAX_HIT_RANGE: 4.0,

    THROW_RANGE: 12,

    SLAM_MIN_RANGE: 4,
    SLAM_MAX_RANGE: 9,
    SLAM_RADIUS: 4.8,

    STAMPEDE_MIN_RANGE: 7,
    STAMPEDE_MAX_RANGE: 16,
    STAMPEDE_RADIUS: 1.9,

    DAMAGE_MELEE: 7,
    DAMAGE_THROW: 8,
    DAMAGE_SLAM: 10,
    DAMAGE_STAMPEDE: 9,

    COOLDOWN_MELEE: 16,
    COOLDOWN_THROW: 75,
    COOLDOWN_SLAM: 130,
    COOLDOWN_STAMPEDE: 160,

    SPEED_REST: 4,
    SPEED_CHASE: 5,
    SPEED_ATTACK: 2,
    SPEED_STAMPEDE: 7,

    SLAM_LEAP_POWER: 0.9,
    SLAM_LEAP_Y: 0.54,

    STAMPEDE_POWER: 0.88
};

// -------------------- TIMERS --------------------

var TIMER_STATE_LOOP       = 100;
var TIMER_ATTACK_IMPACT    = 101;
var TIMER_ATTACK_END       = 102;
var TIMER_SLAM_JUMP        = 103;
var TIMER_THROW_RELEASE    = 104;
var TIMER_STAMPEDE_TICK    = 105;
var TIMER_STAMPEDE_END     = 106;

// -------------------- ATTACK DATA --------------------

var ATTACKS = {
    attack1: {
        id: "attack1",
        anim: CONFIG.ATTACK_1,
        type: "melee",
        duration: 30,
        impact: 14,
        range: CONFIG.MELEE_MAX_HIT_RANGE,
        damage: CONFIG.DAMAGE_MELEE
    },

    attack2: {
        id: "attack2",
        anim: CONFIG.ATTACK_2,
        type: "melee",
        duration: 30,
        impact: 14,
        range: CONFIG.MELEE_MAX_HIT_RANGE,
        damage: CONFIG.DAMAGE_MELEE
    },

    attack3: {
        id: "attack3",
        anim: CONFIG.ATTACK_3,
        type: "slam",
        duration: 69,
        jumpAt: 16,
        impact: 44,
        range: CONFIG.SLAM_RADIUS,
        damage: CONFIG.DAMAGE_SLAM
    },

    attack4: {
        id: "attack4",
        anim: CONFIG.ATTACK_4,
        type: "throw",
        duration: 35,
        impact: 20,
        range: CONFIG.THROW_RANGE,
        damage: CONFIG.DAMAGE_THROW
    }
};

// -------------------- STATE --------------------

var state = {
    dead: false,
    busy: false,
    currentAttack: null,

    targetName: null,
    nextMelee: 1,

    combatTick: 0,
    cdMelee: 0,
    cdThrow: 0,
    cdSlam: 0,
    cdStampede: 0,

    lastMoveAnim: "",

    markX: 0,
    markY: 0,
    markZ: 0,

    chargeX: 0,
    chargeZ: 0,
    chargeHit: {}
};

// =====================================================
// EVENTS
// =====================================================

function init(e) {
    state.dead = false;
    state.busy = false;
    state.currentAttack = null;
    state.targetName = null;

    state.nextMelee = 1;
    state.combatTick = 0;

    state.cdMelee = 0;
    state.cdThrow = 0;
    state.cdSlam = 0;
    state.cdStampede = 0;

    state.lastMoveAnim = "";
    state.chargeHit = {};

    setAi(e.npc, CONFIG.SPEED_REST);
    playAnim(e.npc, CONFIG.IDLE, true);

    var timers = e.npc.getTimers();
    timers.forceStart(TIMER_STATE_LOOP, 5, true);

    debug(e.npc, "Prime combat controller loaded.");
}

function timer(e) {
    var npc = e.npc;

    if (state.dead) return;

    if (e.id == TIMER_STATE_LOOP) {
        combatLoop(npc);
        return;
    }

    if (e.id == TIMER_SLAM_JUMP) {
        doSlamJump(npc);
        return;
    }

    if (e.id == TIMER_ATTACK_IMPACT || e.id == TIMER_THROW_RELEASE) {
        resolveAttackImpact(npc);
        return;
    }

    if (e.id == TIMER_ATTACK_END) {
        finishAttack(npc);
        return;
    }

    if (e.id == TIMER_STAMPEDE_TICK) {
        updateStampede(npc);
        return;
    }

    if (e.id == TIMER_STAMPEDE_END) {
        finishStampede(npc);
        return;
    }
}

function damaged(e) {
    if (state.dead || e.source == null) return;

    try {
        state.targetName = e.source.getName();
        e.npc.setAttackTarget(e.source);
    } catch (err) {}
}

function target(e) {
    try {
        state.targetName = e.entity.getName();
    } catch (err) {}
}

function targetLost(e) {
    if (state.busy || state.dead) return;

    state.targetName = null;
    state.lastMoveAnim = "";
    setAi(e.npc, CONFIG.SPEED_REST);
    playAnim(e.npc, CONFIG.IDLE, false);
}

function died(e) {
    state.dead = true;
    state.busy = true;
    playAnim(e.npc, CONFIG.DEATH, true);
    fxDeath(e.npc);
}

function interact(e) {
    if (CONFIG.DEBUG) {
        e.player.message(JSON.stringify(state));
    }
}

// Cancela el ataque vanilla para evitar doble lógica o desfase.
function meleeAttack(e) {
    e.setCanceled(true);
}

// =====================================================
// MAIN LOOP
// =====================================================

function combatLoop(npc) {
    state.combatTick += 5;

    tickCooldowns();

    if (state.busy) return;

    var target = findTarget(npc);

    if (target == null) {
        state.targetName = null;
        setAi(npc, CONFIG.SPEED_REST);
        setMovementAnim(npc, CONFIG.IDLE);
        return;
    }

    state.targetName = target.getName();

    try {
        npc.setAttackTarget(target);
    } catch (err) {}

    faceTarget(npc, target);

    var d = distance(npc, target);

    if (d > CONFIG.MELEE_RANGE) {
        setAi(npc, CONFIG.SPEED_CHASE);
        setMovementAnim(npc, CONFIG.RUN);
    } else {
        setAi(npc, CONFIG.SPEED_REST);
        setMovementAnim(npc, CONFIG.IDLE);
    }

    var attack = chooseAttack(d);

    if (attack != null) {
        startAttack(npc, target, attack);
    }
}

function tickCooldowns() {
    if (state.cdMelee > 0) state.cdMelee -= 5;
    if (state.cdThrow > 0) state.cdThrow -= 5;
    if (state.cdSlam > 0) state.cdSlam -= 5;
    if (state.cdStampede > 0) state.cdStampede -= 5;
}

// =====================================================
// ACTION SELECTION
// =====================================================

function chooseAttack(d) {
    if (d <= CONFIG.MELEE_RANGE && state.cdMelee <= 0) {
        if (state.nextMelee == 1) {
            state.nextMelee = 2;
            return ATTACKS.attack1;
        } else {
            state.nextMelee = 1;
            return ATTACKS.attack2;
        }
    }

    if (
        d >= CONFIG.STAMPEDE_MIN_RANGE &&
        d <= CONFIG.STAMPEDE_MAX_RANGE &&
        state.cdStampede <= 0
    ) {
        return { type: "stampede" };
    }

    if (
        d >= CONFIG.SLAM_MIN_RANGE &&
        d <= CONFIG.SLAM_MAX_RANGE &&
        state.cdSlam <= 0
    ) {
        return ATTACKS.attack3;
    }

    if (d <= CONFIG.THROW_RANGE && state.cdThrow <= 0) {
        return ATTACKS.attack4;
    }

    return null;
}

// =====================================================
// ATTACK START / END
// =====================================================

function startAttack(npc, target, attack) {
    if (state.busy || state.dead || target == null) return;

    if (attack.type == "stampede") {
        startStampede(npc, target);
        return;
    }

    state.busy = true;
    state.currentAttack = attack;

    markTarget(target);
    faceTarget(npc, target);

    setAi(npc, CONFIG.SPEED_ATTACK);
    playAnim(npc, attack.anim, true);
    fxActionStart(npc, attack.type);

    var timers = npc.getTimers();

    timers.forceStart(TIMER_ATTACK_END, attack.duration, false);

    if (attack.type == "slam") {
        state.cdSlam = CONFIG.COOLDOWN_SLAM;
        timers.forceStart(TIMER_SLAM_JUMP, attack.jumpAt, false);
        timers.forceStart(TIMER_ATTACK_IMPACT, attack.impact, false);
    }
    else if (attack.type == "throw") {
        state.cdThrow = CONFIG.COOLDOWN_THROW;
        timers.forceStart(TIMER_THROW_RELEASE, attack.impact, false);
    }
    else {
        state.cdMelee = CONFIG.COOLDOWN_MELEE;
        timers.forceStart(TIMER_ATTACK_IMPACT, attack.impact, false);
    }

    debug(npc, "Started " + attack.id);
}

function finishAttack(npc) {
    state.busy = false;
    state.currentAttack = null;
    state.lastMoveAnim = "";

    setAi(npc, CONFIG.SPEED_REST);

    var target = findTarget(npc);
    if (target == null) {
        playAnim(npc, CONFIG.IDLE, false);
    }
}

// =====================================================
// IMPACT RESOLUTION
// =====================================================

function resolveAttackImpact(npc) {
    var attack = state.currentAttack;
    if (attack == null) return;

    if (attack.type == "melee") {
        doMeleeImpact(npc, attack);
    }

    if (attack.type == "slam") {
        doSlamImpact(npc, attack);
    }

    if (attack.type == "throw") {
        doThrowImpact(npc, attack);
    }
}

function doMeleeImpact(npc, attack) {
    var target = findTarget(npc);

    fxMeleeImpact(npc, target);

    if (target == null) return;
    if (distance(npc, target) > attack.range) return;

    damageEntity(npc, target, attack.damage);
    knockbackFrom(npc, target, 0.55);

    sound(npc, "minecraft:entity.player.attack.sweep", 1, 0.9);
}

function doThrowImpact(npc, attack) {
    var target = findTarget(npc);

    fxThrowImpact(npc, target);

    if (target == null) return;
    if (distance(npc, target) > attack.range) return;

    damageArea(npc, target.getX(), target.getY(), target.getZ(), 2.4, attack.damage, {});
    sound(npc, "minecraft:entity.blaze.shoot", 1, 1.1);
}

function doSlamJump(npc) {
    var dx = state.markX - npc.getX();
    var dz = state.markZ - npc.getZ();

    var len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.1) len = 0.1;

    var power = CONFIG.SLAM_LEAP_POWER;

    try { npc.setMotionX(dx / len * power); } catch (err) {}
    try { npc.setMotionZ(dz / len * power); } catch (err2) {}
    try { npc.setMotionY(CONFIG.SLAM_LEAP_Y); } catch (err3) {}

    fxSlamLeap(npc);
    sound(npc, "minecraft:entity.witch.throw", 0.8, 0.8);
}

function doSlamImpact(npc, attack) {
    fxSlamImpact(npc);

    var hit = {};

    damageArea(
        npc,
        npc.getX(),
        npc.getY(),
        npc.getZ(),
        attack.range,
        attack.damage,
        hit
    );

    damageArea(
        npc,
        state.markX,
        state.markY,
        state.markZ,
        attack.range,
        attack.damage,
        hit
    );

    sound(npc, "minecraft:entity.generic.explode", 0.9, 0.7);
}

// =====================================================
// STAMPEDE
// =====================================================

function startStampede(npc, target) {
    if (state.busy || state.dead || target == null) return;

    state.busy = true;
    state.currentAttack = null;
    state.cdStampede = CONFIG.COOLDOWN_STAMPEDE;
    state.chargeHit = {};

    markTarget(target);
    faceTarget(npc, target);
    calculateStampedeVector(npc, target);

    setAi(npc, CONFIG.SPEED_STAMPEDE);
    playAnim(npc, CONFIG.RUN, true);
    fxStampedeStart(npc);

    var timers = npc.getTimers();
    timers.forceStart(TIMER_STAMPEDE_TICK, 2, true);
    timers.forceStart(TIMER_STAMPEDE_END, 42, false);
}

function updateStampede(npc) {
    if (!state.busy || state.dead) return;

    try { npc.setMotionX(state.chargeX * CONFIG.STAMPEDE_POWER); } catch (err) {}
    try { npc.setMotionZ(state.chargeZ * CONFIG.STAMPEDE_POWER); } catch (err2) {}

    damageArea(
        npc,
        npc.getX(),
        npc.getY(),
        npc.getZ(),
        CONFIG.STAMPEDE_RADIUS,
        CONFIG.DAMAGE_STAMPEDE,
        state.chargeHit
    );

    fxStampedeTrail(npc);
}

function finishStampede(npc) {
    try { npc.getTimers().stop(TIMER_STAMPEDE_TICK); } catch (err) {}

    try { npc.setMotionX(0); } catch (err2) {}
    try { npc.setMotionZ(0); } catch (err3) {}

    state.busy = false;
    state.currentAttack = null;
    state.lastMoveAnim = "";

    setAi(npc, CONFIG.SPEED_REST);
}

function calculateStampedeVector(npc, target) {
    var dx = target.getX() - npc.getX();
    var dz = target.getZ() - npc.getZ();

    var len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.1) len = 0.1;

    state.chargeX = dx / len;
    state.chargeZ = dz / len;
}

// =====================================================
// TARGETING
// =====================================================

function findTarget(npc) {
    var current = null;

    try {
        current = npc.getAttackTarget();
        if (current != null && current.isAlive()) return current;
    } catch (err) {}

    if (state.targetName != null && state.targetName != "") {
        try {
            var p = npc.getWorld().getPlayer(state.targetName);
            if (p != null && p.isAlive()) return p;
        } catch (err2) {}
    }

    try {
        var list = npc.getWorld().getNearbyEntities(npc.getPos(), CONFIG.AGGRO_RANGE, 1);

        if (list == null || list.length == 0) return null;

        var best = null;
        var bestDist = 9999;

        for (var i = 0; i < list.length; i++) {
            var ent = list[i];

            if (!isValidTarget(ent)) continue;

            var d = distance(npc, ent);
            if (d < bestDist) {
                best = ent;
                bestDist = d;
            }
        }

        return best;
    } catch (err3) {}

    return null;
}

function isValidTarget(ent) {
    if (ent == null) return false;

    try {
        if (!ent.isAlive()) return false;
    } catch (err) {}

    return true;
}

function markTarget(target) {
    try {
        state.markX = target.getX();
        state.markY = target.getY();
        state.markZ = target.getZ();
    } catch (err) {}
}

// =====================================================
// DAMAGE / AREA / KNOCKBACK
// =====================================================

function damageEntity(npc, target, amount) {
    try {
        target.damage(amount);
        return;
    } catch (err) {}

    try {
        npc.executeCommand('/damage "' + target.getName() + '" ' + amount);
    } catch (err2) {}
}

function damageArea(npc, x, y, z, radius, damage, hit) {
    try {
        var scan = distanceXYZ(npc, x, y, z) + radius + 1;
        var list = npc.getWorld().getNearbyEntities(npc.getPos(), Math.ceil(scan), 1);

        if (list == null) return;

        for (var i = 0; i < list.length; i++) {
            var ent = list[i];

            if (!isValidTarget(ent)) continue;
            if (distanceXYZ(ent, x, y, z) > radius) continue;

            var id = "";
            try { id = ent.getUUID(); } catch (err0) {}

            if (id != "" && hit[id]) continue;
            if (id != "") hit[id] = true;

            damageEntity(npc, ent, damage);
            knockbackFromPoint(ent, x, z, 0.85);
        }
    } catch (err) {}
}

function knockbackFrom(npc, target, power) {
    knockbackFromPoint(target, npc.getX(), npc.getZ(), power);
}

function knockbackFromPoint(target, x, z, power) {
    try {
        var dx = target.getX() - x;
        var dz = target.getZ() - z;

        var len = Math.sqrt(dx * dx + dz * dz);
        if (len <= 0) len = 1;

        target.setMotionX((dx / len) * power);
        target.setMotionY(0.25);
        target.setMotionZ((dz / len) * power);
    } catch (err) {}
}

// =====================================================
// ANIMATIONS
// =====================================================

function playAnim(npc, anim, replay) {
    if (anim == null || anim == "") return;

    if (!replay && state.lastMoveAnim == anim) return;

    var cmd = CONFIG.ANIM_COMMAND_BASE
        .replace("{target}", CONFIG.ANIM_TARGET_SELECTOR)
        .replace("{anim}", anim);

    try {
        npc.executeCommand(cmd);
    } catch (err) {}

    if (!replay) {
        state.lastMoveAnim = anim;
    }

    debug(npc, "Anim: " + anim);
}

function setMovementAnim(npc, anim) {
    if (state.lastMoveAnim == anim) return;
    playAnim(npc, anim, false);
}

// =====================================================
// AI / FACE
// =====================================================

function setAi(npc, speed) {
    try { npc.getAi().setMovingType(1); } catch (err) {}
    try { npc.getAi().setStandingType(2); } catch (err2) {}
    try { npc.getAi().setWalkingSpeed(speed); } catch (err3) {}
}

function faceTarget(npc, target) {
    try {
        npc.setRotation(rotationTo(npc, target));
    } catch (err) {}
}

// =====================================================
// EFFECTS
// =====================================================

function fxActionStart(npc, type) {
    if (type == "melee") {
        particleAt(npc, "minecraft:smoke", npc.getX(), npc.getY() + 1, npc.getZ(), 8, 0.25, 0.25, 0.25, 0.03);
    }

    if (type == "slam") {
        particleAt(npc, "minecraft:ash", state.markX, state.markY + 0.1, state.markZ, 22, 0.9, 0.06, 0.9, 0.02);
        particleAt(npc, "minecraft:dust", state.markX, state.markY + 0.05, state.markZ, 10, 0.7, 0.02, 0.7, 0.01);
    }

    if (type == "throw") {
        particleAt(npc, "minecraft:witch", npc.getX(), npc.getY() + 1.3, npc.getZ(), 16, 0.35, 0.35, 0.35, 0.04);
        particleAt(npc, "minecraft:soul_fire_flame", npc.getX(), npc.getY() + 1.4, npc.getZ(), 8, 0.25, 0.25, 0.25, 0.02);
    }
}

function fxMeleeImpact(npc, target) {
    var x = npc.getX();
    var y = npc.getY() + 1.1;
    var z = npc.getZ();

    if (target != null) {
        x = target.getX();
        y = target.getY() + 1;
        z = target.getZ();
    }

    particleAt(npc, "minecraft:sweep_attack", x, y, z, 5, 0.35, 0.15, 0.35, 0.01);
    particleAt(npc, "minecraft:crit", x, y, z, 22, 0.5, 0.25, 0.5, 0.08);
    particleAt(npc, "minecraft:poof", x, y, z, 8, 0.25, 0.2, 0.25, 0.03);
}

function fxThrowImpact(npc, target) {
    particleAt(npc, "minecraft:witch", npc.getX(), npc.getY() + 1.4, npc.getZ(), 18, 0.35, 0.35, 0.35, 0.04);
    particleAt(npc, "minecraft:soul_fire_flame", npc.getX(), npc.getY() + 1.4, npc.getZ(), 12, 0.35, 0.35, 0.35, 0.03);

    if (target != null) {
        particleAt(npc, "minecraft:poof", target.getX(), target.getY() + 1, target.getZ(), 28, 0.55, 0.3, 0.55, 0.03);
        particleAt(npc, "minecraft:ash", target.getX(), target.getY() + 0.1, target.getZ(), 24, 0.8, 0.05, 0.8, 0.02);
        particleAt(npc, "minecraft:flame", target.getX(), target.getY() + 1, target.getZ(), 12, 0.35, 0.5, 0.35, 0.03);
    }
}

function fxSlamLeap(npc) {
    particleAt(npc, "minecraft:cloud", npc.getX(), npc.getY() + 0.15, npc.getZ(), 22, 0.8, 0.1, 0.8, 0.04);
    particleAt(npc, "minecraft:smoke", npc.getX(), npc.getY() + 0.4, npc.getZ(), 14, 0.45, 0.3, 0.45, 0.03);
}

function fxSlamImpact(npc) {
    particleAt(npc, "minecraft:explosion", npc.getX(), npc.getY() + 0.2, npc.getZ(), 1, 0, 0, 0, 0);
    particleAt(npc, "minecraft:cloud", npc.getX(), npc.getY() + 0.1, npc.getZ(), 38, 1.3, 0.18, 1.3, 0.03);
    particleAt(npc, "minecraft:ash", npc.getX(), npc.getY() + 0.1, npc.getZ(), 34, 1.2, 0.06, 1.2, 0.02);
    particleAt(npc, "minecraft:crit", npc.getX(), npc.getY() + 0.8, npc.getZ(), 24, 0.8, 0.4, 0.8, 0.06);

    particleAt(npc, "minecraft:ash", state.markX, state.markY + 0.1, state.markZ, 36, 1.2, 0.06, 1.2, 0.02);
}

function fxStampedeStart(npc) {
    particleAt(npc, "minecraft:angry_villager", npc.getX(), npc.getY() + 1.8, npc.getZ(), 8, 0.2, 0.2, 0.2, 0.02);
    particleAt(npc, "minecraft:cloud", npc.getX(), npc.getY() + 0.1, npc.getZ(), 22, 0.7, 0.08, 0.7, 0.04);
    sound(npc, "minecraft:entity.ravager.roar", 0.9, 0.8);
}

function fxStampedeTrail(npc) {
    particleAt(npc, "minecraft:cloud", npc.getX(), npc.getY() + 0.1, npc.getZ(), 8, 0.45, 0.06, 0.45, 0.04);
    particleAt(npc, "minecraft:ash", npc.getX(), npc.getY() + 0.2, npc.getZ(), 6, 0.35, 0.05, 0.35, 0.02);
}

function fxDeath(npc) {
    particleAt(npc, "minecraft:soul", npc.getX(), npc.getY() + 1, npc.getZ(), 30, 0.6, 0.8, 0.6, 0.04);
    particleAt(npc, "minecraft:large_smoke", npc.getX(), npc.getY() + 1, npc.getZ(), 18, 0.5, 0.5, 0.5, 0.03);
    sound(npc, "minecraft:entity.wither.death", 0.6, 1.4);
}

// =====================================================
// PARTICLES / SOUND
// =====================================================

function particleAt(npc, name, x, y, z, count, sx, sy, sz, speed) {
    try {
        npc.getWorld().spawnParticle(name, x, y, z, sx, sy, sz, speed, count);
    } catch (err) {}
}

function sound(npc, soundName, volume, pitch) {
    try {
        npc.getWorld().playSoundAt(npc.getPos(), soundName, volume, pitch);
    } catch (err) {}
}

// =====================================================
// MATH
// =====================================================

function distance(a, b) {
    return distanceXYZ(a, b.getX(), b.getY(), b.getZ());
}

function distanceXYZ(a, x, y, z) {
    var dx = a.getX() - x;
    var dy = a.getY() - y;
    var dz = a.getZ() - z;

    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function rotationTo(a, b) {
    return rotFromDelta(b.getX() - a.getX(), b.getZ() - a.getZ());
}

function rotFromDelta(dx, dz) {
    var r = Math.atan2(-dx, dz) * 180 / Math.PI;

    while (r < 0) r += 360;
    while (r >= 360) r -= 360;

    return r;
}

function debug(npc, msg) {
    if (CONFIG.DEBUG) {
        try {
            npc.say("[DEBUG] " + msg);
        } catch (err) {}
    }
}
