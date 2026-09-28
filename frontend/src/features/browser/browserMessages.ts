/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { useCallback } from "react";
import { useI18n } from "../../i18n";
const messages: Record<string, readonly [string, string, string]> = {
  "This folder": [
    "Ce dossier",
    "Dieser Ordner",
    "此文件夹"
  ],
  "With subfolders": [
    "Avec sous-dossiers",
    "Mit Unterordnern",
    "包含子文件夹"
  ],
  "Whole bucket": [
    "Tout le bucket",
    "Gesamter Bucket",
    "整个存储桶"
  ],
  "Whole space": [
    "Tout l’espace",
    "Gesamter Speicherbereich",
    "整个存储空间"
  ],
  "Search scope": [
    "Portée de recherche",
    "Suchbereich",
    "搜索范围"
  ],
  "Search unavailable": [
    "Recherche indisponible",
    "Suche nicht verfügbar",
    "搜索不可用"
  ],
  "Searching…": [
    "Recherche en cours…",
    "Suche läuft…",
    "正在搜索…"
  ],
  "Partial results — load more to continue": [
    "Résultats partiels — charger la suite pour continuer",
    "Teilergebnisse — weitere laden",
    "部分结果 — 加载更多以继续"
  ],
  "Search complete": [
    "Recherche terminée",
    "Suche abgeschlossen",
    "搜索完成"
  ],
  "Widen search scope": [
    "Élargir la recherche",
    "Suchbereich erweitern",
    "扩大搜索范围"
  ],
  "File filters": [
    "Filtres des fichiers",
    "Dateifilter",
    "文件筛选"
  ],
  " (active)": [
    " (actifs)",
    " (aktiv)",
    "（已启用）"
  ],
  "Minimum bytes": [
    "Taille minimale (octets)",
    "Mindestgröße (Bytes)",
    "最小字节数"
  ],
  "Maximum bytes": [
    "Taille maximale (octets)",
    "Maximalgröße (Bytes)",
    "最大字节数"
  ],
  "Modified after": [
    "Modifié après",
    "Geändert nach",
    "修改时间起"
  ],
  "Modified before": [
    "Modifié avant",
    "Geändert vor",
    "修改时间止"
  ],
  "Extensions, separated by commas": [
    "Extensions séparées par des virgules",
    "Dateiendungen, durch Kommas getrennt",
    "扩展名，以逗号分隔"
  ],
  "Size, modification time and extension filters return files only. Dates use your local time zone.": [
    "Les filtres de taille, date et extension concernent les fichiers. Les dates utilisent votre fuseau horaire.",
    "Größe, Datum und Dateiendung filtern nur Dateien. Datumsangaben verwenden Ihre Zeitzone.",
    "大小、修改日期和扩展名仅筛选文件。日期使用您的本地时区。"
  ],
  "Choose Files or All in search options to use these filters.": [
    "Choisissez Fichiers ou Tous pour utiliser ces filtres.",
    "Wählen Sie Dateien oder Alle, um diese Filter zu verwenden.",
    "请选择文件或全部以使用这些筛选条件。"
  ],
  "Folders and deletion markers are excluded while these filters are active.": [
    "Les dossiers et marqueurs de suppression sont exclus lorsque ces filtres sont actifs.",
    "Ordner und Löschmarkierungen werden bei aktiven Filtern ausgeschlossen.",
    "启用这些筛选条件时将排除文件夹和删除标记。"
  ],
  "Rename": [
    "Renommer",
    "Umbenennen",
    "重命名"
  ],
  "Move to": [
    "Déplacer vers",
    "Verschieben nach",
    "移动到"
  ],
  "Copy to": [
    "Copier vers",
    "Kopieren nach",
    "复制到"
  ],
  "New name": [
    "Nouveau nom",
    "Neuer Name",
    "新名称"
  ],
  "Find a Storage Space": [
    "Rechercher un espace de stockage",
    "Speicherbereich suchen",
    "查找存储空间"
  ],
  "Find a bucket": [
    "Rechercher un bucket",
    "Bucket suchen",
    "查找存储桶"
  ],
  "Destination": [
    "Destination",
    "Ziel",
    "目标"
  ],
  " (read only)": [
    " (lecture seule)",
    " (schreibgeschützt)",
    "（只读）"
  ],
  "More destinations": [
    "Autres destinations",
    "Weitere Ziele",
    "更多目标"
  ],
  "Destination folder": [
    "Dossier de destination",
    "Zielordner",
    "目标文件夹"
  ],
  "An empty path selects the root. Keys are preserved exactly.": [
    "Un chemin vide sélectionne la racine. Les clés sont conservées à l’identique.",
    "Ein leerer Pfad wählt die Wurzel. Schlüssel bleiben unverändert.",
    "空路径表示根目录，键名将完整保留。"
  ],
  "Destination folders": [
    "Dossiers de destination",
    "Zielordner",
    "目标文件夹"
  ],
  "Parent folder": [
    "Dossier parent",
    "Übergeordneter Ordner",
    "上级文件夹"
  ],
  "More folders": [
    "Autres dossiers",
    "Weitere Ordner",
    "更多文件夹"
  ],
  "Only current objects move. Older versions remain at their original keys. An unverified copy keeps its source.": [
    "Seuls les objets courants sont déplacés. Les anciennes versions restent à leur clé d’origine. La source est conservée si la copie ne peut pas être vérifiée.",
    "Nur aktuelle Objekte werden verschoben. Ältere Versionen bleiben am ursprünglichen Schlüssel. Ohne bestätigte Kopie bleibt die Quelle erhalten.",
    "仅移动当前对象。历史版本仍保留在原键名下。副本无法验证时将保留源对象。"
  ],
  "Choose a different destination outside the selected folder.": [
    "Choisissez une autre destination en dehors du dossier sélectionné.",
    "Wählen Sie ein anderes Ziel außerhalb des ausgewählten Ordners.",
    "请选择所选文件夹之外的其他目标。"
  ],
  "Loading folders…": [
    "Chargement des dossiers…",
    "Ordner werden geladen…",
    "正在加载文件夹…"
  ],
  "Cancel": [
    "Annuler",
    "Abbrechen",
    "取消"
  ],
  "Favorites and views": [
    "Favoris et vues",
    "Favoriten und Ansichten",
    "收藏和视图"
  ],
  "Synchronization requires a UI account. Temporary S3 sessions cannot save favorites or views to an account.": [
    "La synchronisation nécessite un compte UI. Les sessions S3 temporaires ne peuvent pas enregistrer de favoris ou de vues dans un compte.",
    "Die Synchronisierung erfordert ein UI-Konto. Temporäre S3-Sitzungen können keine Favoriten oder Ansichten im Konto speichern.",
    "同步需要 UI 账户。临时 S3 会话无法将收藏和视图保存到账户。"
  ],
  "Personal to your account, synchronized across browsers.": [
    "Personnels à votre compte et synchronisés entre navigateurs.",
    "Persönlich für Ihr Konto, browserübergreifend synchronisiert.",
    "仅属于您的账户，在不同浏览器间同步。"
  ],
  "Demo: saved locally for this identity.": [
    "Démo : enregistré localement pour cette identité.",
    "Demo: lokal für diese Identität gespeichert.",
    "演示：仅为当前身份保存在本地。"
  ],
  "Rename saved item": [
    "Renommer l’élément enregistré",
    "Gespeicherten Eintrag umbenennen",
    "重命名已保存项"
  ],
  "Name": [
    "Nom",
    "Name",
    "名称"
  ],
  "Save name": [
    "Enregistrer le nom",
    "Namen speichern",
    "保存名称"
  ],
  "Cancel editing": [
    "Annuler la modification",
    "Bearbeitung abbrechen",
    "取消编辑"
  ],
  "Pin location": [
    "Épingler cet emplacement",
    "Ort anheften",
    "收藏位置"
  ],
  "Save view": [
    "Enregistrer la vue",
    "Ansicht speichern",
    "保存视图"
  ],
  "Refresh": [
    "Actualiser",
    "Aktualisieren",
    "刷新"
  ],
  "Update from current view": [
    "Actualiser depuis la vue courante",
    "Mit aktueller Ansicht aktualisieren",
    "使用当前视图更新"
  ],
  "Remove": [
    "Supprimer",
    "Entfernen",
    "移除"
  ],
  "No saved items in this workspace.": [
    "Aucun élément enregistré dans cet espace.",
    "Keine gespeicherten Einträge in diesem Arbeitsbereich.",
    "此工作区中没有已保存项。"
  ],
  "Resolve destination conflicts": [
    "Résoudre les conflits de destination",
    "Zielkonflikte lösen",
    "解决目标冲突"
  ],
  "Replacing an object creates a new current version.": [
    "Remplacer un objet crée une nouvelle version courante.",
    "Das Ersetzen erstellt eine neue aktuelle Version.",
    "替换对象会创建新的当前版本。"
  ],
  "Replacing may permanently overwrite the current object; versioning is not confirmed.": [
    "Le remplacement peut écraser définitivement l’objet courant ; le versioning n’est pas confirmé.",
    "Das Ersetzen kann das aktuelle Objekt dauerhaft überschreiben; die Versionierung ist nicht bestätigt.",
    "替换可能永久覆盖当前对象；版本控制状态未确认。"
  ],
  "Writes will check that the destination has not changed.": [
    "L’écriture vérifiera que la destination n’a pas changé.",
    "Beim Schreiben wird geprüft, ob sich das Ziel geändert hat.",
    "写入时将检查目标是否发生变化。"
  ],
  "This provider uses a preflight check. Concurrent changes cannot be excluded atomically.": [
    "Ce fournisseur utilise un contrôle préalable. Il ne garantit pas l’absence de changement concurrent lors de l’écriture.",
    "Dieser Anbieter verwendet eine Vorabprüfung. Gleichzeitige Änderungen lassen sich nicht atomar ausschließen.",
    "此提供商使用写入前检查，无法以原子操作排除并发更改。"
  ],
  "Replace all": [
    "Tout remplacer",
    "Alle ersetzen",
    "全部替换"
  ],
  "Skip all": [
    "Tout ignorer",
    "Alle überspringen",
    "全部跳过"
  ],
  "Keep both for all": [
    "Tout conserver en double",
    "Beide für alle behalten",
    "全部保留两者"
  ],
  "Incoming": [
    "À écrire",
    "Eingehend",
    "传入"
  ],
  "Existing": [
    "Existant",
    "Vorhanden",
    "现有"
  ],
  "Decision": [
    "Décision",
    "Entscheidung",
    "处理方式"
  ],
  "Duplicate target in this batch": [
    "Destination répétée dans ce lot",
    "Doppeltes Ziel in diesem Stapel",
    "批次中有重复目标"
  ],
  "Unknown size": [
    "Taille inconnue",
    "Unbekannte Größe",
    "大小未知"
  ],
  "Choose…": [
    "Choisir…",
    "Auswählen…",
    "请选择…"
  ],
  "Replace": [
    "Remplacer",
    "Ersetzen",
    "替换"
  ],
  "Skip": [
    "Ignorer",
    "Überspringen",
    "跳过"
  ],
  "Keep both": [
    "Conserver les deux",
    "Beide behalten",
    "保留两者"
  ],
  "Cancel batch": [
    "Annuler le lot",
    "Stapel abbrechen",
    "取消批次"
  ],
  "Apply decisions": [
    "Appliquer les choix",
    "Entscheidungen anwenden",
    "应用选择"
  ],
  "Browser help": [
    "Aide du Browser",
    "Browser-Hilfe",
    "浏览器帮助"
  ],
  "Commands follow the current selection, workspace and storage permissions.": [
    "Les commandes dépendent de la sélection, de l’espace et des droits d’accès au stockage.",
    "Befehle richten sich nach Auswahl, Arbeitsbereich und Speicherberechtigungen.",
    "操作取决于当前选择、工作区和存储访问权限。"
  ],
  "Unavailable actions": [
    "Actions indisponibles",
    "Nicht verfügbare Aktionen",
    "不可用操作"
  ],
  "Unavailable in the current context.": [
    "Indisponible dans ce contexte.",
    "Im aktuellen Kontext nicht verfügbar.",
    "当前上下文中不可用。"
  ],
  "All visible commands are available.": [
    "Toutes les commandes affichées sont disponibles.",
    "Alle sichtbaren Befehle sind verfügbar.",
    "所有显示的操作均可用。"
  ],
  "Keyboard shortcuts": [
    "Raccourcis clavier",
    "Tastenkombinationen",
    "键盘快捷键"
  ],
  "Select loaded items": [
    "Sélectionner les éléments chargés",
    "Geladene Einträge auswählen",
    "选择已加载项"
  ],
  "Edit the current path": [
    "Modifier le chemin courant",
    "Aktuellen Pfad bearbeiten",
    "编辑当前路径"
  ],
  "Copy, cut and paste when allowed": [
    "Copier, couper et coller selon les droits",
    "Kopieren, Ausschneiden und Einfügen, sofern erlaubt",
    "在权限允许时复制、剪切和粘贴"
  ],
  "Navigate rows; hold Shift to extend the selection": [
    "Parcourir les lignes ; maintenir Maj pour étendre la sélection",
    "Zeilen wechseln; Umschalt erweitert die Auswahl",
    "浏览各行；按住 Shift 扩展选择"
  ],
  "Toggle selection / open / clear selection": [
    "Sélectionner / ouvrir / effacer la sélection",
    "Auswahl umschalten / öffnen / Auswahl aufheben",
    "切换选择 / 打开 / 清除选择"
  ],
  "Calculate volume": [
    "Calculer le volume",
    "Volumen berechnen",
    "计算大小"
  ],
  "Cancel calculation": [
    "Annuler le calcul",
    "Berechnung abbrechen",
    "取消计算"
  ],
  "Calculating…": [
    "Calcul en cours…",
    "Wird berechnet…",
    "正在计算…"
  ],
  " known; remaining volume not calculated": [
    " connus ; volume restant non calculé",
    " bekannt; übriges Volumen nicht berechnet",
    "已知；其余大小未计算"
  ],
  "Transfers unavailable": [
    "Transferts indisponibles",
    "Übertragungen nicht verfügbar",
    "传输不可用"
  ],
  "Transfers available via server": [
    "Transferts via le serveur",
    "Übertragung über den Server verfügbar",
    "可通过服务器传输"
  ],
  "Direct transfers available": [
    "Transferts directs disponibles",
    "Direktübertragungen verfügbar",
    "直接传输可用"
  ],
  "Help": [
    "Aide",
    "Hilfe",
    "帮助"
  ],
  "Download as ZIP": [
    "Télécharger en ZIP",
    "Als ZIP herunterladen",
    "下载为 ZIP"
  ],
  "Copy to…": [
    "Copier vers…",
    "Kopieren nach…",
    "复制到…"
  ],
  "Move to…": [
    "Déplacer vers…",
    "Verschieben nach…",
    "移动到…"
  ],
  "Favorites": [
    "Favoris",
    "Favoriten",
    "收藏"
  ],
  "Locations": [
    "Emplacements",
    "Orte",
    "位置"
  ],
  "Saved views": [
    "Vues enregistrées",
    "Gespeicherte Ansichten",
    "已保存视图"
  ],
  "Search favorites": [
    "Rechercher un favori",
    "Favoriten suchen",
    "搜索收藏"
  ],
  "Manage favorites": [
    "Gérer les favoris",
    "Favoriten verwalten",
    "管理收藏"
  ],
  "Display": [
    "Affichage",
    "Anzeige",
    "显示"
  ],
  "Help and shortcuts": [
    "Aide et raccourcis",
    "Hilfe und Tastenkombinationen",
    "帮助和快捷键"
  ],
  "Advanced search": [
    "Recherche avancée",
    "Erweiterte Suche",
    "高级搜索"
  ],
  "Search in": [
    "Rechercher dans",
    "Suchen in",
    "搜索范围"
  ],
  "Apply": [
    "Appliquer",
    "Anwenden",
    "应用"
  ],
  "Reset": [
    "Réinitialiser",
    "Zurücksetzen",
    "重置"
  ],
  "Matching options": [
    "Options de correspondance",
    "Abgleichoptionen",
    "匹配选项"
  ],
  "Exact match": [
    "Correspondance exacte",
    "Exakte Übereinstimmung",
    "精确匹配"
  ],
  "Case-sensitive": [
    "Sensible à la casse",
    "Groß-/Kleinschreibung beachten",
    "区分大小写"
  ],
  "Type": [
    "Type",
    "Typ",
    "类型"
  ],
  "All": [
    "Tous",
    "Alle",
    "全部"
  ],
  "Files": [
    "Fichiers",
    "Dateien",
    "文件"
  ],
  "Folders": [
    "Dossiers",
    "Ordner",
    "文件夹"
  ],
  "Storage class": [
    "Classe de stockage",
    "Speicherklasse",
    "存储类别"
  ],
  "All classes": [
    "Toutes les classes",
    "Alle Klassen",
    "全部类别"
  ],
  "Close": [
    "Fermer",
    "Schließen",
    "关闭"
  ],
  "Compact": [
    "Compact",
    "Kompakt",
    "紧凑"
  ],
  "Comfortable": [
    "Confortable",
    "Komfortabel",
    "宽松"
  ],
  "Density": [
    "Densité",
    "Dichte",
    "密度"
  ],
  "Columns": [
    "Colonnes",
    "Spalten",
    "列"
  ],
  "Folders panel": [
    "Panneau des dossiers",
    "Ordnerbereich",
    "文件夹面板"
  ],
  "Action bar": [
    "Barre d’actions",
    "Aktionsleiste",
    "操作栏"
  ],
  "Known volume": [
    "Volume connu",
    "Bekanntes Volumen",
    "已知大小"
  ]
};
export function useBrowserText() {
  const { locale } = useI18n();
  return useCallback((message: string) => messages[message]?.[({ fr: 0, de: 1, zh: 2 } as Record<string, number>)[locale]] ?? message, [locale]);
}
