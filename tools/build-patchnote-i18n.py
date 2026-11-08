# Writes patchNote.i18n.json: this fork's machine translations of patchNote.json, keyed by entry key.
# Each entry: { "from": <original language>, "<other language>": { "title": ..., "notes": [...] } }.
# Translations are listed in patchNote.json's order; the script pairs them with the keys and checks counts.
# PT holds every entry (both languages' originals) in patchNote.json's order.
import json, re, sys, os

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = json.load(open(os.path.join(root, 'patchNote.json'), encoding='utf-8'))

ZH = {
    "2026-11-08": [
        "结果中的数字以 4 位有效数字显示，10,000 及以上使用 k、M、B、T（123.5k、1.235M）；鼠标悬停可查看精确数值",
        "右上角新增 ISO 数字格式开关：百分比显示为 1.79 %，千位分隔显示为 1 234；默认关闭，并会被记住",
        "黑暗模式开关移到右上角，位于语言按钮旁边",
        "模拟器现已支持葡萄牙语，使用游戏官方的葡萄牙语名称",
    ],
    "2026-11-07": [
        "战斗属性面板现在还会计入已装备的饮品和玩家自己装备的光环，无需任何设置；它显示的属性与同一玩家在战斗中的属性一致",
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

PT = [
    [
        "Os números nos resultados aparecem com 4 algarismos significativos, com k, M, B e T a partir de 10,000 (123.5k, 1.235M); passe o mouse sobre um número para ver o valor exato",
        "Nova chave Números ISO no canto superior direito: porcentagens como 1.79 % e milhares como 1 234; vem desligada e é lembrada",
        "A chave do Modo Escuro foi para o canto superior direito, ao lado dos botões de idioma",
        "O simulador agora está disponível em português, com os nomes oficiais do jogo em português",
    ],
    ["O painel de Atributos de Combate agora também conta as bebidas equipadas e as auras equipadas do próprio jogador, sem nenhuma opção para ligar; os atributos mostrados batem com os que o mesmo jogador tem em combate"],
    [
        "Os bônus de guilda agora são lidos dos dois formatos de exportação",
        "O painel de Atributos de Combate mostra os atributos que a simulação usa (cômodos da casa, conquistas, guilda, comunidade e outros bônus), com os níveis efetivos de habilidade e Descoberta Rara",
        "Os bônus comunitários de XP e de drop de combate vêm ligados por padrão no nível 20 e podem ser editados",
    ],
    ["Suporte a melhorias do Labirinto", "Suporte a bônus de santuário"],
    ["Atualização dos dados de equipamento e dos nomes traduzidos"],
    ["Novos campos com as tentativas do Labirinto e a taxa de sucesso no Labirinto"],
    ["Otimização do desempenho da simulação relacionada à Fúria"],
    ["Suporte aos bônus pessoais dados pelos pergaminhos do Labirinto"],
    ["Atualização dos dados para o patch do Labirinto", "Nova simulação do Labirinto, individual e em lote"],
    [
        "Corrigida a precisão do cálculo do nível de combate",
        "Corrigido o intervalo antes de voltar ao combate depois de concluir ou falhar uma masmorra, por wangchyan",
        "Corrigidas as durações de Maldição e Enfraquecer, por wangchyan",
        "Corrigida a lógica de ativação de Maldição e Fúria, por wangchyan",
        "Corrigida parte da lógica de reinício da masmorra quando o grupo inteiro morre, por wangchyan",
        "Corrigidos alguns bônus da Aura Guardiã e da Aura de Velocidade que não escalavam direito com o nível, por wangchyan",
        "Corrigido Invencível não afetando direito a Tenacidade, por wangchyan",
        "Corrigidas unidades que não comiam e bebiam primeiro ao entrar em combate, por wangchyan",
        "As estatísticas de duração de combate agora contam só as batalhas terminadas, não mais a batalha em andamento, por wangchyan",
    ],
    ["Corrigidos gatilhos que contavam por engano unidades já mortas, por wangchyan"],
    [
        "Recurso experimental: gráficos de HP/MP, por wangchyan",
        "Corrigido o dano defensivo que não recebia direito os bônus de dano, por wangchyan",
        "Corrigido o bônus de cura da Aura Guardiã que não fazia efeito, por wangchyan",
        "Corrigidas Socorro Rápido e habilidades parecidas que não miravam direito o aliado com menor % de HP, por wangchyan",
    ],
    ["As masmorras agora registram o tempo de conclusão mais rápido"],
    ["Corrigida uma falha na escolha de habilidades que podia causar falta anormal de mana e problemas parecidos"],
    ["Suporte ao sistema de conquistas e seus bônus", "Os drops de monstros de masmorra não se aplicam mais"],
    ["Corrigido um erro causado quando, depois de uma atualização do jogo, habilidades sem gatilho mudaram de [] para null"],
    ["Suporte à busca de preços pela API do site espelho chinês"],
    ["Corrigido o intervalo de ataque dos monstros que não escalava com o nível de Ataque"],
    ["Corrigida uma falha de ativação da Aura Crítica"],
    ["Reviver não limpa mais todos os bônus por engano", "O registro de derrota agora registra dano de retaliação, espinhos e dano contínuo"],
    [
        "Nova simulação em lote de combate solo e as opções de monstro correspondentes",
        "Novas opções de MooPass e de bônus comunitários, com seus efeitos",
        "Melhoria dos atributos de equipamentos refinados",
        "Redução dos atributos do Bispo Encantado",
        "Atualização dos dados do jogo: init_client_info_v1.20250819.0.json",
    ],
    ["Corrigidos possíveis erros nos cálculos de XP e de drops em casos extremos"],
    ["Incorporada a reformulação dos ramos Test e Temp", "Atualização dos dados do jogo: init_client_info_v1.20250818.0.json"],
    [
        "Corrigidas habilidades perfurantes que podiam acertar o mesmo alvo mais de uma vez",
        "Corrigida a exibição do registro de derrota no modo escuro",
        "Atualizada a fórmula do nível de combate",
        "Ajustados os espinhos do Golem de Estalactite",
        "Atualização dos dados do jogo: init_client_info_v1.20250626.0_0817.json",
    ],
    [
        "Novo botão Parar Simulação, por BKN46",
        "Novos botões para reordenar habilidades, por BKN46",
        "Novo registro de derrota, por TruthLight",
        "Atualização dos atributos dos monstros",
        "Reflexo Arcano renomeado para Retribuição",
        "Atualização dos dados do jogo: init_client_info_v1.20250626.0_0815.json",
    ],
    [
        "Atualização dos atributos dos monstros",
        "Ajuste dos atributos de equipamentos de longo alcance e de magia",
        "Ajuste do limite do dano de retaliação",
        "Corrigidas habilidades lançadas entre batalhas",
        "Corrigida a lógica de decisão de lançamento de habilidades",
        "Proporção de falta de mana mais precisa",
        "15% da XP de Longo Alcance e 12% da XP de Magia agora vão para a XP de Ataque",
        "Atualização dos dados do jogo: init_client_info_v1.20250626.0_0813.json",
    ],
    [
        "Atualização dos atributos dos monstros",
        "Atualização dos tempos de lançamento das habilidades corpo a corpo e físicas",
        "Ajuste dos valores de Golpe de Escudo e Golpe Atordoante",
        "Ajuste do bônus de XP de Defesa dos baluartes",
        "Atualização dos dados do jogo: init_client_info_v1.20250626.0_0811.json",
    ],
    [
        "Implementada a penalidade de drops e de XP quando os níveis dos membros do grupo diferem demais",
        "Implementado o aumento da XP dos monstros com a porcentagem de progresso do Frenesi",
        "Ajuste dos valores da Aura Crítica",
        "Exibição do nível de combate",
        "Exibição da penalidade por diferença de nível",
        "Atualização dos dados do jogo: init_client_info_v1.20250626.0_0807.json",
    ],
    [
        "Corrigidas quantidades anormais de alguns drops de itens duplicados em combate em grupo, por contr4l",
        "Atualização dos dados do jogo: init_client_info_v1.20250626.0_0806.json",
    ],
    [
        "A mecânica de Frenesi dos monstros e seu gatilho agora fazem efeito",
        "Atualização dos equipamentos refinados, ajuste dos valores dos amuletos, a Aura Guardiã adiciona evasão",
        "Atualização dos dados do jogo: init_client_info_v1.20250626.0_0802.json",
        "Máximo de acúmulos da Fúria corrigido para 5",
        "Ajuste de como o aparo é resolvido",
    ],
    [
        "Atualização dos dados de itens e dos atributos dos monstros",
        "Reformulação de Casco Espinhoso e Reflexo Arcano",
        "Atualização dos valores de aprimoramento",
        "Remoção de gatilhos quebrados",
        "Reformulação do Enfraquecer do Baluarte de Grifo",
        "O aparo da Espada Real agora se aplica aos colegas de equipe",
        "Máximo de acúmulos do efeito Fúria corrigido para 6",
        "O efeito Ondulante agora restaura 10 MP",
        "A retaliação agora mostra sua taxa de acerto corretamente",
        "Ajuste da mecânica de retaliação",
        "Sincronizadas as mudanças nos atributos dos baluartes e nos valores das habilidades de retaliação e espinhos",
    ],
    ["A Aura Crítica agora escala com o nível de Longo Alcance", "Ajuste dos valores base das auras e de como escalam com o nível"],
    [
        "A simulação em lote permite escolher planetas",
        "Divisão de XP ajustada para 30% + 70%",
        "Auras e seus gatilhos, escalados por uma porcentagem do nível da habilidade correspondente",
        "Água, fogo e natureza agora usam a Aura Mística por padrão",
        "Atualização dos dados do jogo: init_client_info_v1.20250626.0_0717.json",
    ],
    [
        "Atualização das fórmulas de XP dos monstros e de nível das habilidades",
        "Atualização das fórmulas de evasão e de resistência",
        "Poder substituído por Corpo a Corpo, com a compatibilidade correspondente",
        "Atualização dos dados do jogo: init_client_info_v1.20250626.0_0711.json",
    ],
    ["Corrigidas habilidades perfurantes que podiam acertar o mesmo alvo várias vezes quando lançadas por inimigos"],
    [
        "Ajustes de drops e de taxas de drop",
        "Ajustes de XP",
        "Ajuste de Tiro Pestilento e Perfurar",
        "Remoção da regeneração automática dos monstros",
        "Ajuste do gatilho do Tiro Pestilento",
        "Uso da API oficial para buscar preços",
    ],
    [
        "Escala dos atributos dos monstros e várias dificuldades de mapa",
        "Ajustes das habilidades de magia; o atributo 'dano de habilidade' dos equipamentos agora faz efeito",
        "O nível de Ataque e os níveis dos cômodos da casa agora afetam a velocidade de lançamento",
        "Ajustes de itens",
        "Precisão reformulada para usar o nível de Ataque",
        "TESTE: 10% da XP de Longo Alcance e de Magia agora vão para a XP de Ataque!",
        "Reformulação da XP e equipamento de amuleto",
    ],
]

out = {"_label": {"en": "Machine translation by Ramlock", "zh": "机器翻译（Ramlock 提供）", "pt": "Tradução automática por Ramlock"}}
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
if len(PT) != len(src):
    sys.exit(f"count mismatch: {len(src)} entries, {len(PT)} Portuguese translations")
for k, notes in zip(src, PT):
    orig = src[k] if isinstance(src[k], list) else src[k]["notes"]
    if len(orig) != len(notes):
        sys.exit(f"{k}: {len(orig)} notes, {len(notes)} in Portuguese")
    m = re.match(r'^(\d{4})年(\d{1,2})月(\d{1,2})日$', k) or re.match(r'^(\d{4})-(\d{2})-(\d{2})$', k)
    y, mo, d = m.groups()
    out.setdefault(k, {"from": "en"})["pt"] = {"title": f"{int(d):02d}/{int(mo):02d}/{y}", "notes": notes}
missing = [k for k in src if k not in out]
if missing:
    sys.exit(f"untranslated: {missing}")
with open(os.path.join(root, 'patchNote.i18n.json'), 'w', encoding='utf-8', newline='\n') as f:
    json.dump(out, f, ensure_ascii=False, indent=4)
    f.write('\n')
print(f"wrote {len(out) - 1} entries")
