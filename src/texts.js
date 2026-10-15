// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys: feature names, connection status,
// errors, the "Test the connection" report, command errors. The widget keeps
// its own short texts (src/widgets.js). Four languages, the four of the Gladys
// interface; German says "du", Spanish "usted". test/i18n.test.js checks every
// table. Brand names (OpenSprinkler, Gladys) are never translated.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './opensprinkler/client.js';

/** A multi-language object (or a string) in one language, English as fallback. */
export function pick(value, language) {
  if (typeof value === 'string') {
    return value;
  }
  return value?.[language] ?? value?.en ?? '';
}

/** "Name: text", with the French space before the colon. */
export function labelled(name, text, language) {
  return language === 'fr' ? `${name} : ${text}` : `${name}: ${text}`;
}

// Feature names, fixed at the creation of the device in Gladys. The station
// features take the station name set on the controller.
export const NAMES = {
  en: {
    enabled: 'Controller enabled',
    waterLevel: 'Watering level',
    rainDelay: 'Rain delay',
    rainSensor: 'Rain sensor',
    soilSensor: 'Soil sensor (wet)',
    flowRate: 'Water flow',
    waterCounter: 'Water meter',
    station: 'Station',
    program: 'Program',
  },
  fr: {
    enabled: 'Contrôleur activé',
    waterLevel: "Niveau d'arrosage",
    rainDelay: 'Délai de pluie',
    rainSensor: 'Capteur de pluie',
    soilSensor: 'Capteur de sol (humide)',
    flowRate: "Débit d'eau",
    waterCounter: "Compteur d'eau",
    station: 'Station',
    program: 'Programme',
  },
  de: {
    enabled: 'Steuerung aktiv',
    waterLevel: 'Bewässerungsstufe',
    rainDelay: 'Regenpause',
    rainSensor: 'Regensensor',
    soilSensor: 'Bodensensor (feucht)',
    flowRate: 'Wasserdurchfluss',
    waterCounter: 'Wasserzähler',
    station: 'Station',
    program: 'Programm',
  },
  es: {
    enabled: 'Controlador activado',
    waterLevel: 'Nivel de riego',
    rainDelay: 'Retraso por lluvia',
    rainSensor: 'Sensor de lluvia',
    soilSensor: 'Sensor de suelo (húmedo)',
    flowRate: 'Caudal de agua',
    waterCounter: 'Contador de agua',
    station: 'Estación',
    program: 'Programa',
  },
};

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noController: {
    en: 'Enter the address of your OpenSprinkler in the configuration.',
    fr: "Saisissez l'adresse de votre OpenSprinkler dans la configuration.",
    de: 'Gib die Adresse deines OpenSprinkler in der Konfiguration ein.',
    es: 'Introduzca la dirección de su OpenSprinkler en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. http://192.168.1.20',
    fr: 'Adresse incomprise, ex. http://192.168.1.20',
    de: 'Adresse nicht verstanden, z. B. http://192.168.1.20',
    es: 'Dirección no válida, p. ej. http://192.168.1.20',
  },
};

// One short explanation per error kind (src/opensprinkler/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'does not answer',
    fr: 'ne répond pas',
    de: 'antwortet nicht',
    es: 'no responde',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'password refused',
    fr: 'mot de passe refusé',
    de: 'Passwort abgelehnt',
    es: 'contraseña rechazada',
  },
  [ERROR_KINDS.NOT_OPENSPRINKLER]: {
    en: 'no OpenSprinkler at this address',
    fr: 'aucun OpenSprinkler à cette adresse',
    de: 'kein OpenSprinkler unter dieser Adresse',
    es: 'no hay ningún OpenSprinkler en esta dirección',
  },
  [ERROR_KINDS.REFUSED]: {
    en: 'command refused by the controller',
    fr: 'commande refusée par le contrôleur',
    de: 'Befehl von der Steuerung abgelehnt',
    es: 'orden rechazada por el controlador',
  },
};

// Why the controller refused a command, by API result code.
export const REFUSAL_TEXT = {
  48: {
    en: 'not permitted: the station is already running or waiting, or it is a master station',
    fr: 'refusé : la station arrose déjà ou attend son tour, ou c’est une station maître',
    de: 'nicht erlaubt: Die Station läuft schon oder wartet, oder sie ist eine Master-Station',
    es: 'no permitido: la estación ya riega o está en espera, o es una estación maestra',
  },
  17: {
    en: 'value out of range for this controller',
    fr: 'valeur hors limites pour ce contrôleur',
    de: 'Wert außerhalb des Bereichs dieser Steuerung',
    es: 'valor fuera de rango para este controlador',
  },
  other: {
    en: 'command refused by the controller',
    fr: 'commande refusée par le contrôleur',
    de: 'Befehl von der Steuerung abgelehnt',
    es: 'orden rechazada por el controlador',
  },
};

export const ACTION_TEXT = {
  noController: CONNECTION_TEXT.noController,
  unknownController: {
    en: 'This OpenSprinkler is not configured in the integration.',
    fr: "Cet OpenSprinkler n'est pas configuré dans l'intégration.",
    de: 'Dieser OpenSprinkler ist in der Integration nicht eingerichtet.',
    es: 'Este OpenSprinkler no está configurado en la integración.',
  },
  notRead: {
    en: 'The controller has not been read yet, try again in a moment.',
    fr: "Le contrôleur n'a pas encore été lu, réessayez dans un instant.",
    de: 'Die Steuerung wurde noch nicht gelesen, versuch es gleich noch einmal.',
    es: 'El controlador aún no se ha leído, inténtelo de nuevo en un momento.',
  },
  unknownStation: {
    en: 'This station number does not exist on the controller.',
    fr: "Ce numéro de station n'existe pas sur le contrôleur.",
    de: 'Diese Stationsnummer gibt es auf der Steuerung nicht.',
    es: 'Este número de estación no existe en el controlador.',
  },
  unknownProgram: {
    en: 'This program number does not exist on the controller.',
    fr: "Ce numéro de programme n'existe pas sur le contrôleur.",
    de: 'Diese Programmnummer gibt es auf der Steuerung nicht.',
    es: 'Este número de programa no existe en el controlador.',
  },
  masterStation: {
    en: 'A master station only runs with the stations it serves.',
    fr: 'Une station maître ne fonctionne qu’avec les stations qu’elle dessert.',
    de: 'Eine Master-Station läuft nur mit den Stationen, die sie versorgt.',
    es: 'Una estación maestra solo funciona con las estaciones a las que sirve.',
  },
  badMinutes: {
    en: 'Enter a duration between 1 and 1080 minutes.',
    fr: 'Indiquez une durée entre 1 et 1080 minutes.',
    de: 'Gib eine Dauer zwischen 1 und 1080 Minuten ein.',
    es: 'Indique una duración entre 1 y 1080 minutos.',
  },
  badHours: {
    en: 'Enter a rain delay between 0 and 720 hours.',
    fr: 'Indiquez un délai de pluie entre 0 et 720 heures.',
    de: 'Gib eine Regenpause zwischen 0 und 720 Stunden ein.',
    es: 'Indique un retraso por lluvia entre 0 y 720 horas.',
  },
};

// The "Test the connection" report, one line per controller.
export const REPORT_TEXT = {
  en: {
    ok: 'connected',
    firmware: (version) => `firmware ${version}`,
    counts: (stations, programs) => `${stations} stations, ${programs} programs`,
    disabled: 'controller disabled',
    watering: (count) => `${count} watering`,
  },
  fr: {
    ok: 'connecté',
    firmware: (version) => `firmware ${version}`,
    counts: (stations, programs) => `${stations} stations, ${programs} programmes`,
    disabled: 'contrôleur désactivé',
    watering: (count) => `${count} en arrosage`,
  },
  de: {
    ok: 'verbunden',
    firmware: (version) => `Firmware ${version}`,
    counts: (stations, programs) => `${stations} Stationen, ${programs} Programme`,
    disabled: 'Steuerung deaktiviert',
    watering: (count) => `${count} bewässern`,
  },
  es: {
    ok: 'conectado',
    firmware: (version) => `firmware ${version}`,
    counts: (stations, programs) => `${stations} estaciones, ${programs} programas`,
    disabled: 'controlador desactivado',
    watering: (count) => `${count} regando`,
  },
};
