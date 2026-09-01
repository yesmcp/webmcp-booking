// Every string the booking script can say, in both languages.
//
// It lives here, outside the pages, because three doors now open onto the same
// calendar: /book/, /ua/book/ and the Telegram Mini App at /book/tg/. The Mini
// App ships BOTH sets in its markup and picks one at runtime from the Telegram
// user's language, so a copy edit that touched only two of the three files
// would be a silent divergence. One object, three importers, no drift.
//
// The English page is the original; the Ukrainian one is a translation of it.

export const bookEn = {
  loading: "Loading the open times…",
  ourTime: "our time:",
  pickDay: "Pick a day with an open window.",
  noneOnDay: "no open windows",
  // Read out by the calendar: "Thu 3 September, 2 times available".
  count: { one: "time available", other: "times available" },
  noneUntil: "Nothing open in the next few days. The next window is",
  noneAtAll:
    "No windows are open right now. Write to us and we will arrange a time by hand.",
  loadFailed: "The open times could not be loaded just now.",
  sending: "Booking…",
  submit: "Book this time",
  networkFailed: "That did not reach us. Check the connection and try again: nothing was booked.",
  genericFailed: "That did not go through, and nothing was booked. Please try again.",
  invalidGeneric: "Please check the form and try again.",
  invalid: {
    name: "Please add the name you would like on the booking.",
    email: "That email address does not look right, and the confirmation has to reach you.",
    topic: "Please say in a sentence what you would like to discuss.",
    slotId: "Please pick a time first.",
  },
  junk: "Please describe in a sentence what you would like to discuss.",
  rateLimited: "Too many attempts just now. Give it a couple of minutes: nothing was booked.",
  taken: "That window was taken while you were deciding. The list below is up to date.",
  unknownSlot: "That window is no longer available. The list below is up to date.",
  sendFailed:
    "The confirmation email could not be sent, so the booking was not made and the window is still open. Check the address and try again.",
  roomInEmail: "the link is in your email",
};

export const bookUk = {
  loading: "Завантажуємо вільний час…",
  ourTime: "наш час:",
  pickDay: "Оберіть день, у якому є вільне вікно.",
  noneOnDay: "вільних вікон немає",
  // Календар читає це вголос: «чт, 3 вересня, 2 вільні вікна».
  count: {
    one: "вільне вікно",
    few: "вільні вікна",
    many: "вільних вікон",
    other: "вільних вікон",
  },
  noneUntil: "Найближчими днями вільного немає. Наступне вікно:",
  noneAtAll: "Зараз вільних вікон немає. Напишіть нам, і ми домовимося про час вручну.",
  loadFailed: "Не вдалося завантажити вільний час.",
  sending: "Записуємо…",
  submit: "Записатися на цей час",
  networkFailed: "Це до нас не дійшло. Перевірте зв'язок і спробуйте ще раз: запис не створено.",
  genericFailed: "Не вдалося записати, і нічого не збережено. Спробуйте ще раз.",
  invalidGeneric: "Перевірте, будь ласка, форму.",
  invalid: {
    name: "Додайте ім'я, на яке робимо запис.",
    email: "Ця адреса виглядає непевно, а підтвердження має до вас дійти.",
    topic: "Напишіть одним реченням, про що хочете поговорити.",
    slotId: "Спершу оберіть час.",
  },
  junk: "Опишіть одним реченням, про що хочете поговорити.",
  rateLimited: "Забагато спроб поспіль. Дайте пару хвилин: запис не створено.",
  taken: "Це вікно зайняли, поки ви обирали. Список нижче вже свіжий.",
  unknownSlot: "Цього вікна більше немає. Список нижче вже свіжий.",
  sendFailed:
    "Лист із підтвердженням не вдалося надіслати, тому запис не створено, а вікно лишається вільним. Перевірте адресу і спробуйте ще раз.",
  roomInEmail: "посилання є у вашому листі",
};
