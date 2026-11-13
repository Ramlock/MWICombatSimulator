# Writes patchNote.i18n.json: this fork's machine translations of patchNote.json, keyed by entry key.
# Each entry: { "from": <original language>, "<other language>": { "title": ..., "notes": [...] } }.
# Translations are listed in patchNote.json's order; the script pairs them with the keys and checks counts.
# PT holds every entry (both languages' originals) in patchNote.json's order.
import json, re, sys, os

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = json.load(open(os.path.join(root, 'patchNote.json'), encoding='utf-8'))

ZH = {
    "2026-11-13": [
        "假设分析：食物和饮品现在是两个独立选项，可以只搜索其中一个",
        "假设分析：运行次数太少的数值显示为短横线，而不是数字",
        "假设分析：“采纳当前领先者”原样采用领先者；“跳过”立即结束该部分并保留已完成的运行",
        "假设分析：搜索结束后会显示哪些部分已运行、哪些由你结束，以及途中排除了哪些改动",
        "假设分析：“单项改动”每个设置只显示一行，而不是同一设置的多个数值",
        "导入分组现在会在刷新页面后保留，包括名称",
        "导入技能少于四个、或特殊技能栏为空的配置，不再失败",
        "导入配置后，导入窗口现在会自动关闭",
        "假设分析：公开页面上的“假设分析”按钮会说明如何获取运行器",
        "导入带有光环的配置时，现在会选中光环，并把技能放进正确的栏位",
    ],
    "2026-11-12": [
        "假设分析：正在运行的阶段新增“采纳当前领先者”和“跳过”按钮",
        "假设分析：较弱的改动会在搜索过程中被淘汰，包括回本太慢的付费改动",
        "假设分析：尚未分出高下的一组会显示大约还需要几轮",
        "假设分析：搜索做出的每个选择都会用新的运行重新核对；你采纳的选择按原样采用",
    ],
    "2026-11-10": [
        "全区域结果上方新增图表：每张地图是一个点，每小时经验对每日利润，点击圆点可跳到对应行",
        "掉落、消耗品和宝箱的价格在所选一侧没有价格时，现在先用另一侧，再用商店价格",
        "假设分析窗口：每项改动显示队伍收益和购买者自己的收益，以及成本和回本天数",
        "假设分析窗口：适应屏幕宽度，没有横向滚动条",
        "假设分析：先搜索食物和饮品，显示为“最佳食物”和“最佳饮品”；“应用”会先放入它们",
    ],
    "2026-11-09": [
        "本地假设分析运行器的假设分析窗口：设置预算和搜索内容，可停止搜索，一键应用建议的改动",
        "结果：“法力值耗尽”下方的“触发条件等待”显示每个技能被什么拖住",
        "结果：“法力值耗尽比例”始终显示，取代是/否一行",
        "导入分组时也会勾选其中的玩家，并设置其指定的区域和难度",
    ],
    "2026-11-08": [
        "结果中的数字缩写显示，10,000 起使用 k、M、B 和 T",
        "右上角新增 ISO 数字开关",
        "页面默认以黑暗模式打开",
        "模拟器现已支持葡萄牙语",
        "模拟速度提升约五倍",
    ],
    "2026-11-07": [
        "战斗属性面板现在会计入已装备的饮品和你自己装备的光环",
    ],
    "2026-11-04": [
        "公会增益可从两种导出格式读取",
        "战斗属性面板显示模拟所用的属性，包括房屋、成就以及公会和社区增益",
        "社区经验和战斗掉落增益默认开启，等级为20，可编辑",
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
        "E se: Comidas e Bebidas agora são duas opções separadas, para buscar uma sem a outra",
        "E se: um valor de poucas execuções mostra um traço em vez de um número",
        "E se: Aceitar o vencedor atual pega o líder como está; Pular encerra a parte na hora e mantém as execuções concluídas",
        "E se: uma busca concluída mostra quais partes rodaram, quais você encerrou e quais alterações ficaram de fora pelo caminho",
        "E se: Cada alteração isolada mostra uma linha por configuração, em vez de vários valores de uma configuração",
        "Importar um grupo agora é lembrado ao recarregar a página, nomes incluídos",
        "Importar uma configuração com menos de quatro habilidades, ou com o espaço de habilidade especial vazio, não falha mais",
        "Depois de importar uma configuração, a janela de importação agora fecha sozinha",
        "E se: o botão E se na página pública explica como obter o executor",
        "Importar um perfil com aura agora seleciona a aura e coloca as habilidades nos espaços certos",
    ],
    [
        "E se: botões Aceitar o vencedor atual e Pular na etapa em andamento",
        "E se: alterações fracas saem conforme a busca avança, incluindo alterações pagas com retorno lento demais",
        "E se: um grupo que ainda não se separou mostra cerca de quantas rodadas a mais precisa",
        "E se: toda escolha da busca é conferida de novo em execuções novas; uma escolha que você aceita é tomada como está",
    ],
    [
        "Um gráfico acima dos resultados de todas as zonas: cada mapa é um ponto, EXP por hora contra lucro por dia, clique em um ponto para ir às suas linhas",
        "Preços de drops, consumíveis e baús agora usam o outro lado e depois o preço de vendedor quando o lado escolhido não tem preço",
        "Janela E se: cada alteração mostra o ganho do grupo e o ganho do próprio comprador, com custo e dias de retorno",
        "Janela E se: ocupa a largura da tela, sem barra de rolagem horizontal",
        "E se: comidas e bebidas são buscadas primeiro e mostradas como Melhores comidas e Melhores bebidas; Aplicar coloca elas primeiro",
    ],
    [
        "Janela E se para o executor local do E se: defina um orçamento e o que buscar, pare a busca e aplique uma alteração sugerida com um clique",
        "Resultados: Retido por gatilho, abaixo de Ficou sem mana, mostra o que segurou cada técnica",
        "Resultados: Proporção sem mana sempre aparece, no lugar da linha Sim/Não",
        "Importar um grupo também marca seus jogadores e define a zona e o nível que ele indica",
    ],
    [
        "Os números dos resultados aparecem abreviados, com k, M, B e T a partir de 10.000",
        "Nova chave Números ISO no canto superior direito",
        "A página abre no modo escuro por padrão",
        "O simulador agora está disponível em português",
        "As simulações rodam cerca de cinco vezes mais rápido",
    ],
    [
        "O painel de Atributos de Combate agora conta as bebidas equipadas e as suas próprias auras equipadas",
    ],
    [
        "Os buffs de guilda são lidos dos dois formatos de exportação",
        "O painel de Atributos de Combate mostra os atributos que a simulação usa, incluindo cômodos da casa, conquistas e buffs de guilda e da comunidade",
        "Os buffs comunitários de EXP e de loot de combate vêm ligados por padrão no nível 20 e podem ser editados",
    ],
    ["Suporte a melhorias do Labirinto", "Suporte a buffs de santuário"],
    ["Atualização dos dados de equipamento e dos nomes traduzidos"],
    ["Novos campos com as tentativas do Labirinto e a taxa de sucesso no Labirinto"],
    ["Otimização do desempenho da simulação relacionada à Fúria"],
    ["Suporte aos buffs pessoais dados pelos pergaminhos do Labirinto"],
    ["Atualização dos dados para o patch do Labirinto", "Nova simulação do Labirinto, individual e em lote"],
    [
        "Corrigida a precisão do cálculo do nível de combate",
        "Corrigido o intervalo antes de voltar ao combate depois de concluir ou falhar uma masmorra, por wangchyan",
        "Corrigidas as durações de Maldição e Enfraquecer, por wangchyan",
        "Corrigida a lógica de ativação de Maldição e Fúria, por wangchyan",
        "Corrigida parte da lógica de reinício da masmorra quando o grupo inteiro morre, por wangchyan",
        "Corrigidos alguns buffs da Aura Guardiã e da Aura de Velocidade que não escalavam direito com o nível, por wangchyan",
        "Corrigido Invencível não afetando direito a Tenacidade, por wangchyan",
        "Corrigidas unidades que não comiam e bebiam primeiro ao entrar em combate, por wangchyan",
        "As estatísticas de duração de combate agora contam só as batalhas terminadas, não mais a batalha em andamento, por wangchyan",
    ],
    ["Corrigidos gatilhos que contavam por engano unidades já mortas, por wangchyan"],
    [
        "Recurso experimental: gráficos de HP/MP, por wangchyan",
        "Corrigido o dano defensivo que não recebia direito os bônus de dano, por wangchyan",
        "Corrigido o bônus de cura da Aura Guardiã que não fazia efeito, por wangchyan",
        "Corrigidas Socorro Rápido e técnicas parecidas que não miravam direito o aliado com menor % de HP, por wangchyan",
    ],
    ["As masmorras agora registram o tempo de conclusão mais rápido"],
    ["Corrigida uma falha na escolha de técnicas que podia causar falta anormal de mana e problemas parecidos"],
    ["Suporte ao sistema de conquistas e seus buffs", "O loot de monstros de masmorra não se aplicam mais"],
    ["Corrigido um erro causado quando, depois de uma atualização do jogo, técnicas sem gatilho mudaram de [] para null"],
    ["Suporte à busca de preços pela API do site espelho chinês"],
    ["Corrigido o intervalo de ataque dos monstros que não escalava com o nível de Ataque"],
    ["Corrigida uma falha de ativação da Aura Crítica"],
    ["Reviver não limpa mais todos os buffs por engano", "O registro de derrota agora registra dano de retaliação, espinhos e dano contínuo"],
    [
        "Nova simulação em lote de combate solo e as opções de monstro correspondentes",
        "Novas opções de MooPass e de buffs comunitários, com seus efeitos",
        "Melhoria dos atributos de equipamentos refinados",
        "Redução dos atributos do Bispo Encantado",
        "Atualização dos dados do jogo: init_client_info_v1.20250819.0.json",
    ],
    ["Corrigidos possíveis erros nos cálculos de EXP e de loot em casos extremos"],
    ["Incorporada a reformulação dos ramos Test e Temp", "Atualização dos dados do jogo: init_client_info_v1.20250818.0.json"],
    [
        "Corrigidas técnicas perfurantes que podiam acertar o mesmo alvo mais de uma vez",
        "Corrigida a exibição do registro de derrota no modo escuro",
        "Atualizada a fórmula do nível de combate",
        "Ajustados os espinhos do Golem de Estalactite",
        "Atualização dos dados do jogo: init_client_info_v1.20250626.0_0817.json",
    ],
    [
        "Novo botão Parar Simulação, por BKN46",
        "Novos botões para reordenar técnicas, por BKN46",
        "Novo registro de derrota, por TruthLight",
        "Atualização dos atributos dos monstros",
        "Reflexo Arcano renomeado para Retribuição",
        "Atualização dos dados do jogo: init_client_info_v1.20250626.0_0815.json",
    ],
    [
        "Atualização dos atributos dos monstros",
        "Ajuste dos atributos de equipamentos à distância e de magia",
        "Ajuste do limite do dano de retaliação",
        "Corrigidas técnicas conjuradas entre batalhas",
        "Corrigida a lógica de decisão de conjuração de técnicas",
        "Proporção de falta de mana mais precisa",
        "15% da EXP de À Distância e 12% da EXP de Magia agora vão para a EXP de Ataque",
        "Atualização dos dados do jogo: init_client_info_v1.20250626.0_0813.json",
    ],
    [
        "Atualização dos atributos dos monstros",
        "Atualização dos tempos de conjuração das técnicas corpo a corpo e físicas",
        "Ajuste dos valores de Golpe de Escudo e Golpe Atordoante",
        "Ajuste do bônus de EXP de Defesa dos baluartes",
        "Atualização dos dados do jogo: init_client_info_v1.20250626.0_0811.json",
    ],
    [
        "Implementada a penalidade de loot e de EXP quando os níveis dos membros do grupo diferem demais",
        "Implementado o aumento da EXP dos monstros com a porcentagem de progresso da Fúria",
        "Ajuste dos valores da Aura Crítica",
        "Exibição do nível de combate",
        "Exibição da penalidade por diferença de nível",
        "Atualização dos dados do jogo: init_client_info_v1.20250626.0_0807.json",
    ],
    [
        "Corrigidas quantidades anormais de alguns loot de itens duplicados em combate em grupo, por contr4l",
        "Atualização dos dados do jogo: init_client_info_v1.20250626.0_0806.json",
    ],
    [
        "A mecânica de Fúria dos monstros e seu gatilho agora fazem efeito",
        "Atualização dos equipamentos refinados, ajuste dos valores dos amuletos, a Aura Guardiã adiciona evasão",
        "Atualização dos dados do jogo: init_client_info_v1.20250626.0_0802.json",
        "Máximo de acúmulos da Fúria corrigido para 5",
        "Ajuste de como Aparar é resolvido",
    ],
    [
        "Atualização dos dados de itens e dos atributos dos monstros",
        "Reformulação de Carapaça de Espinhos e Reflexo Arcano",
        "Atualização dos valores de aprimoramento",
        "Remoção de gatilhos quebrados",
        "Reformulação do Enfraquecer do Baluarte de Grifo",
        "O Aparar da Espada Régia agora se aplica aos colegas de equipe",
        "Máximo de acúmulos do efeito Fúria corrigido para 6",
        "O efeito Ondulante agora restaura 10 MP",
        "A retaliação agora mostra sua taxa de acerto corretamente",
        "Ajuste da mecânica de retaliação",
        "Sincronizadas as mudanças nos atributos dos baluartes e nos valores das técnicas de retaliação e espinhos",
    ],
    ["A Aura Crítica agora escala com o nível de À Distância", "Ajuste dos valores base das auras e de como escalam com o nível"],
    [
        "A simulação em lote permite escolher planetas",
        "Divisão de EXP ajustada para 30% + 70%",
        "Auras e seus gatilhos, escalados por uma porcentagem do nível da técnica correspondente",
        "Água, fogo e natureza agora usam a Aura Mística por padrão",
        "Atualização dos dados do jogo: init_client_info_v1.20250626.0_0717.json",
    ],
    [
        "Atualização das fórmulas de EXP dos monstros e de nível das técnicas",
        "Atualização das fórmulas de evasão e de resistência",
        "Poder substituído por Corpo a Corpo, com a compatibilidade correspondente",
        "Atualização dos dados do jogo: init_client_info_v1.20250626.0_0711.json",
    ],
    ["Corrigidas técnicas perfurantes que podiam acertar o mesmo alvo várias vezes quando conjuradas por inimigos"],
    [
        "Ajustes de loot e de taxas de loot",
        "Ajustes de EXP",
        "Ajuste de Tiro Pestilento e Perfuração",
        "Remoção da regeneração automática dos monstros",
        "Ajuste do gatilho do Tiro Pestilento",
        "Uso da API oficial para buscar preços",
    ],
    [
        "Escala dos atributos dos monstros e várias dificuldades de mapa",
        "Ajustes das técnicas de magia; o atributo 'dano de técnica' dos equipamentos agora faz efeito",
        "O nível de Ataque e os níveis dos cômodos da casa agora afetam a velocidade de conjuração",
        "Ajustes de itens",
        "Precisão reformulada para usar o nível de Ataque",
        "TESTE: 10% da EXP de À Distância e de Magia agora vão para a EXP de Ataque!",
        "Reformulação da EXP e equipamento de amuleto",
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
