/** Uganda's districts, for the RSLA member-profile location field. Not
 * exhaustive of every district ever gazetted (the list changes as new
 * districts are split off older ones) but covers all the ones riders are
 * realistically registering from. Grouped by region only for readability
 * here — exported flat, alphabetical, for use in a plain <select>. */
export const UGANDA_DISTRICTS = [
  "Abim", "Adjumani", "Agago", "Alebtong", "Amolatar", "Amudat", "Amuria", "Amuru", "Apac", "Arua",
  "Budaka", "Bududa", "Bugiri", "Bugweri", "Buhweju", "Buikwe", "Bukedea", "Bukomansimbi", "Bukwo", "Bulambuli",
  "Buliisa", "Bundibugyo", "Bushenyi", "Busia", "Butaleja", "Butambala", "Butebo", "Buvuma", "Buyende",
  "Dokolo",
  "Gomba", "Gulu",
  "Hoima",
  "Ibanda", "Iganga", "Isingiro",
  "Jinja",
  "Kaabong", "Kabale", "Kabarole", "Kaberamaido", "Kagadi", "Kakumiro", "Kalaki", "Kalangala", "Kaliro",
  "Kalungu", "Kampala", "Kamuli", "Kamwenge", "Kanungu", "Kapchorwa", "Kapelebyong", "Karenga", "Kasanda",
  "Kasese", "Katakwi", "Kayunga", "Kazo", "Kibaale", "Kiboga", "Kibuku", "Kikuube", "Kiruhura", "Kiryandongo",
  "Kisoro", "Kitagwenda", "Kitgum", "Koboko", "Kole", "Kotido", "Kumi", "Kwania", "Kween", "Kyankwanzi",
  "Kyegegwa", "Kyenjojo", "Kyotera",
  "Lamwo", "Lira", "Luuka", "Luwero", "Lwengo", "Lyantonde",
  "Madi-Okollo", "Manafwa", "Maracha", "Masaka", "Masindi", "Mayuge", "Mbale", "Mbarara", "Mitooma", "Mityana",
  "Moroto", "Moyo", "Mpigi", "Mubende", "Mukono",
  "Nabilatuk", "Nakapiripirit", "Nakaseke", "Nakasongola", "Namayingo", "Namisindwa", "Namutumba", "Napak",
  "Nebbi", "Ngora", "Ntoroko", "Ntungamo", "Nwoya",
  "Obongi", "Omoro", "Otuke", "Oyam",
  "Pader", "Pakwach", "Pallisa", "Rakai", "Rubanda", "Rubirizi", "Rukiga", "Rukungiri",
  "Serere", "Sheema", "Sironko", "Soroti", "Ssembabule",
  "Terego", "Tororo",
  "Wakiso",
  "Yumbe",
  "Zombo",
] as const;

export type UgandaDistrict = (typeof UGANDA_DISTRICTS)[number];
