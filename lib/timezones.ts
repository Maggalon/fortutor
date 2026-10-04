const russianZones: Record<number, { value: string; city: string }> = {
  2: { value: "Europe/Kaliningrad", city: "Калининград" },
  3: { value: "Europe/Moscow", city: "Москва" },
  4: { value: "Europe/Samara", city: "Самара" },
  5: { value: "Asia/Yekaterinburg", city: "Екатеринбург" },
  6: { value: "Asia/Omsk", city: "Омск" },
  7: { value: "Asia/Krasnoyarsk", city: "Красноярск" },
  8: { value: "Asia/Irkutsk", city: "Иркутск" },
  9: { value: "Asia/Yakutsk", city: "Якутск" },
  10: { value: "Asia/Vladivostok", city: "Владивосток" },
  11: { value: "Asia/Magadan", city: "Магадан" },
  12: { value: "Asia/Kamchatka", city: "Камчатка" },
};

export function timezoneOptions(current: string) {
  const options = Array.from({ length: 27 }, (_, i) => {
    const offset = i - 12;
    const russian = russianZones[offset];
    // IANA Etc/GMT identifiers use the opposite sign to the UTC offset.
    const value =
      russian?.value ??
      (offset === 0
        ? "UTC"
        : `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset)}`);
    const utc =
      offset === 0
        ? "UTC+0"
        : `UTC${offset > 0 ? "+" : "−"}${Math.abs(offset)}`;
    return { value, label: russian ? `${utc} — ${russian.city}` : utc };
  });
  // Keep a previously entered regional zone, including its seasonal clock rules.
  if (!options.some((option) => option.value === current)) {
    const offset = new Intl.DateTimeFormat("en", {
      timeZone: current,
      timeZoneName: "shortOffset",
    })
      .formatToParts(new Date())
      .find((part) => part.type === "timeZoneName")!.value;
    options.push({
      value: current,
      label: `${offset === "GMT" ? "UTC+0" : offset.replace("GMT", "UTC")} — ${current}`,
    });
  }
  return options;
}
