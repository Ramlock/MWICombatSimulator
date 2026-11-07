# Writes patchNote.i18n.json: this fork's machine translations of patchNote.json, keyed by entry key.
# Each entry: { "from": <original language>, "<other language>": { "title": ..., "notes": [...] } }.
# Translations are listed in patchNote.json's order; the script pairs them with the keys and checks counts.
import json, re, sys, os

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = json.load(open(os.path.join(root, 'patchNote.json'), encoding='utf-8'))

ZH = {
    "2026-11-07": [
        "战斗属性面板现在还会计入已装备的饮品和玩家自己装备的光环，无需任何设置；它显示的属性与同一玩家在战斗中的属性一致",
        "全新用户脚本版本（导出器 0.2.0）：游玩时记录整个队伍的战斗，新增菜单命令“复制战利品导出”和“清除已记录的战利品”，并可设置仅导出自己的角色",
    ],
    "2026-11-04": [
        "现在可从两种导出格式读取公会增益",
        "战斗属性面板显示模拟所用的属性（房屋、成就、公会、社区及其他增益），包括有效技能等级和稀有发现",
        "社区经验和战斗掉落增益默认开启（20级），并可编辑",
    ],
}

EN = [
    ["Support Labyrinth upgrades", "Support shrine buffs"],
    ["Update equipment data and localized names"],
    ["Add fields showing Labyrinth attempts and Labyrinth success rate"],
    ["Optimize simulation performance related to Fury"],
    ["Support the personal buffs granted by Labyrinth scrolls"],
    ["Update data for the Labyrinth patch", "Add single and batch Labyrinth simulation"],
    [
        "Fix the precision of the combat level calculation",
        "Fix the interval before re-entering combat after a dungeon is completed or failed by wangchyan",
        "Fix the durations of Curse and Weaken by wangchyan",
        "Fix the trigger logic of Curse and Fury by wangchyan",
        "Fix part of the logic of the dungeon reset on a party wipe by wangchyan",
        "Fix some Guardian Aura and Speed Aura buffs not scaling correctly with their level by wangchyan",
        "Fix Invincible not correctly affecting Tenacity by wangchyan",
        "Fix units not eating and drinking first when they first enter combat by wangchyan",
        "Combat duration statistics now count only finished battles, no longer the battle still in progress by wangchyan",
    ],
    ["Fix triggers wrongly counting units that have already died by wangchyan"],
    [
        "Experimental feature: add HP/MP charts by wangchyan",
        "Fix defensive damage not correctly receiving damage bonuses by wangchyan",
        "Fix Guardian Aura's healing bonus not taking effect by wangchyan",
        "Fix Quick Aid and similar abilities not correctly targeting the lowest HP% ally by wangchyan",
    ],
    ["Dungeons now record the fastest completion time"],
    ["Fix a flaw in ability selection that could cause abnormal mana shortages and similar issues"],
    ["Support the achievement system and its buffs", "Dungeon monster drops no longer apply"],
    ["Fix an error caused when, after a game update, abilities with no trigger changed from [] to null"],
    ["Support fetching prices from the CN mirror site's API"],
    ["Fix monster attack interval not scaling with Attack level"],
    ["Fix a Critical Aura trigger flaw"],
    ["Reviving no longer wrongly clears all buffs", "The wipe log now records retaliation, thorns and DoT damage"],
    [
        "Add batch simulation of solo combat and the matching monster options",
        "Add MooPass and community buff options and their effects",
        "Buff refined equipment stats",
        "Nerf Enchanted Bishop stats",
        "Game data update: init_client_info_v1.20250819.0.json",
    ],
    ["Fix possible errors in XP and drop calculations in extreme cases"],
    ["Merge the rework from the Test and Temp branches", "Game data update: init_client_info_v1.20250818.0.json"],
    [
        "Fix pierce abilities possibly hitting the same target more than once",
        "Fix the wipe log display in dark mode",
        "Update the combat level formula",
        "Adjust Stalactite Golem's thorns",
        "Game data update: init_client_info_v1.20250626.0_0817.json",
    ],
    [
        "Add a Stop Simulation button by BKN46",
        "Add buttons to reorder abilities by BKN46",
        "Add the wipe log by TruthLight",
        "Update monster stats",
        "Arcane Reflection renamed to Retribution",
        "Game data update: init_client_info_v1.20250626.0_0815.json",
    ],
    [
        "Update monster stats",
        "Adjust ranged and magic equipment stats",
        "Adjust the cap on retaliation damage",
        "Fix abilities being cast between battles",
        "Fix the ability casting decision logic",
        "More accurate mana depletion ratio",
        "15% of Ranged XP and 12% of Magic XP now go to Attack XP",
        "Game data update: init_client_info_v1.20250626.0_0813.json",
    ],
    [
        "Update monster stats",
        "Update cast times of melee and physical abilities",
        "Adjust Shield Bash and Stunning Blow values",
        "Adjust the Defense XP bonus of bulwarks",
        "Game data update: init_client_info_v1.20250626.0_0811.json",
    ],
    [
        "Implement the drop and XP penalty when party members' levels differ too much",
        "Implement monster XP increasing with the Berserk progress percentage",
        "Adjust Critical Aura values",
        "Show the combat level",
        "Show the level gap penalty",
        "Game data update: init_client_info_v1.20250626.0_0807.json",
    ],
    [
        "Fix abnormal quantities of some duplicated item drops in party combat by contr4l",
        "Game data update: init_client_info_v1.20250626.0_0806.json",
    ],
    [
        "Monster Berserk mechanic and its trigger now take effect",
        "Refined equipment update, charm values adjusted, Guardian Aura adds evasion",
        "Game data update: init_client_info_v1.20250626.0_0802.json",
        "Fury max stacks corrected to 5",
        "Adjust how parry is resolved",
    ],
    [
        "Update item data and monster stats",
        "Rework Spike Shell and Arcane Reflection",
        "Update enhancement values",
        "Remove broken triggers",
        "Rework Griffin Bulwark's Weaken",
        "Regal Sword's parry now applies to teammates",
        "Fury effect max stacks corrected to 6",
        "Rippling effect now restores 10 MP",
        "Retaliation now shows its hit rate correctly",
        "Adjust the retaliation mechanic",
        "Sync the changes to bulwark stats and to retaliation and thorns ability values",
    ],
    ["Critical Aura now scales with Ranged level", "Adjust aura base values and level scaling"],
    [
        "Batch simulation supports selecting planets",
        "XP split adjusted to 30% + 70%",
        "Auras and their triggers, scaled by a percentage of the matching ability level",
        "Water, fire and nature now default to Mystic Aura",
        "Game data update: init_client_info_v1.20250626.0_0717.json",
    ],
    [
        "Update monster XP and ability level formulas",
        "Update evasion and resistance formulas",
        "Power replaced by Melee, with matching compatibility",
        "Game data update: init_client_info_v1.20250626.0_0711.json",
    ],
    ["Fix pierce abilities possibly hitting the same target several times when cast by enemies"],
    [
        "Drop and drop rate adjustments",
        "XP adjustments",
        "Adjust Pestilent Shot and Puncture",
        "Remove monster auto-regeneration",
        "Adjust the Pestilent Shot trigger",
        "Use the official API to fetch prices",
    ],
    [
        "Monster stat scaling and multiple map difficulties",
        "Magic ability adjustments; the 'ability damage' affix on equipment now takes effect",
        "Attack level and house room levels now affect cast speed",
        "Item adjustments",
        "Precision reworked to use Attack level",
        "TEST: 10% of Ranged and Magic XP now goes to Attack XP!",
        "XP rework and charm equipment",
    ],
]

out = {"_label": {"en": "Machine translation by Ramlock", "zh": "机器翻译（Ramlock 提供）"}}
zh_keys = [k for k in src if re.match(r'^\d{4}年\d{1,2}月\d{1,2}日$', k)]
if len(zh_keys) != len(EN):
    sys.exit(f"count mismatch: {len(zh_keys)} Chinese entries, {len(EN)} translations")
for k, notes in zip(zh_keys, EN):
    orig = src[k] if isinstance(src[k], list) else src[k]["notes"]
    if len(orig) != len(notes):
        sys.exit(f"{k}: {len(orig)} notes, {len(notes)} translated")
    y, m, d = re.match(r'^(\d{4})年(\d{1,2})月(\d{1,2})日$', k).groups()
    out[k] = {"from": "zh", "en": {"title": f"{y}-{int(m):02d}-{int(d):02d}", "notes": notes}}
for k, notes in ZH.items():
    orig = src[k]["notes"]
    if len(orig) != len(notes):
        sys.exit(f"{k}: {len(orig)} notes, {len(notes)} translated")
    y, m, d = k.split('-')
    out[k] = {"from": "en", "zh": {"title": f"{y}年{int(m)}月{int(d)}日", "notes": notes}}
missing = [k for k in src if k not in out]
if missing:
    sys.exit(f"untranslated: {missing}")
with open(os.path.join(root, 'patchNote.i18n.json'), 'w', encoding='utf-8', newline='\n') as f:
    json.dump(out, f, ensure_ascii=False, indent=4)
    f.write('\n')
print(f"wrote {len(out) - 1} entries")
