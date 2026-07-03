const DAY_MS = 24 * 60 * 60 * 1000;

export const GROUPS = [
  { key: "today", label: "今天" },
  { key: "yesterday", label: "昨天" },
  { key: "this-week", label: "本周" },
  { key: "last-week", label: "上周" },
  { key: "two-weeks-ago", label: "2 周前" },
  { key: "one-month-ago", label: "一个月前" },
  { key: "older", label: "更早" },
  { key: "unknown", label: "未知/估算失败" }
];

export const OLD_GROUP_KEYS = new Set(["last-week", "two-weeks-ago", "one-month-ago", "older"]);

export function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function groupTimestamp(timestamp, now = new Date()) {
  if (!Number.isFinite(timestamp)) {
    return GROUPS.find((group) => group.key === "unknown");
  }

  const targetDay = startOfDay(new Date(timestamp));
  const currentDay = startOfDay(now);
  const ageInDays = Math.floor((currentDay.getTime() - targetDay.getTime()) / DAY_MS);

  if (ageInDays <= 0) return GROUPS.find((group) => group.key === "today");
  if (ageInDays === 1) return GROUPS.find((group) => group.key === "yesterday");
  if (ageInDays <= 6) return GROUPS.find((group) => group.key === "this-week");
  if (ageInDays <= 13) return GROUPS.find((group) => group.key === "last-week");
  if (ageInDays <= 27) return GROUPS.find((group) => group.key === "two-weeks-ago");
  if (ageInDays <= 59) return GROUPS.find((group) => group.key === "one-month-ago");
  return GROUPS.find((group) => group.key === "older");
}

export function groupTabs(tabs, now = new Date()) {
  const groupsByKey = new Map(GROUPS.map((group) => [group.key, { ...group, tabs: [] }]));

  for (const tab of tabs) {
    const group = groupTimestamp(tab.ageTimestamp, now);
    groupsByKey.get(group.key).tabs.push({
      ...tab,
      groupKey: group.key,
      groupLabel: group.label
    });
  }

  return GROUPS.map((group) => groupsByKey.get(group.key)).filter((group) => group.tabs.length > 0);
}

export function isOldGroup(groupKey) {
  return OLD_GROUP_KEYS.has(groupKey);
}

