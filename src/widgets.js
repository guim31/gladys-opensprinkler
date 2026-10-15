// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `controller`.
//
// The use case: from the wall tablet, see what waters and for how long, water
// one bed now ("the tomatoes look thirsty"), stop everything (the kids are on
// the lawn), or hold the schedule after a storm. So the widget shows the
// watering level, the rain delay and the flow as tiles, a status list (the
// controller, then each station watering or waiting with its remaining time),
// and four buttons: Water…, Program…, Stop all, Rain delay… (or Cancel the
// rain delay while one runs).
//
// The values are sent inline, not bound to device features: the widget works
// before the device is added to Gladys.
//
// The forms behind "Water…", "Program…" and "Rain delay…" (widget action
// fields, GladysAssistant/Gladys#3168) need Gladys 5.2.0, hence the manifest's
// `gladys_version`; an older core relays the tap without the values, answered
// by a message asking to update Gladys.
//
// Budget (8 components, 6 tiles, 1 status, 4 buttons): at most 3 tiles, one
// status list of 10 rows, 4 buttons.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { controllerName, stationName } from './devices.js';
import {
  DEFAULT_RAIN_DELAY_HOURS,
  MAX_RAIN_DELAY_HOURS,
  MAX_RUN_MINUTES,
  WIDGET_KEY,
} from './hub.js';
import { ERROR_KINDS } from './opensprinkler/client.js';
import { pick } from './texts.js';

// Action keys of the buttons: permanent once published (unique, the core
// drops a button whose key is taken).
export const ACTIONS = Object.freeze({
  RUN_STATION: 'run_station',
  RUN_PROGRAM: 'run_program',
  STOP_ALL: 'stop_all',
  RAIN_DELAY: 'rain_delay',
  CANCEL_RAIN_DELAY: 'cancel_rain_delay',
});

const MAX_ROWS = 10;

export const TEXT = {
  pick: {
    en: 'Enter the address of your OpenSprinkler in the configuration of the integration.',
    fr: "Saisissez l'adresse de votre OpenSprinkler dans la configuration de l'intégration.",
    de: 'Gib die Adresse deines OpenSprinkler in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección de su OpenSprinkler en la configuración de la integración.',
  },
  unknown: {
    en: 'This OpenSprinkler is no longer in the configuration: choose another one in the widget settings.',
    fr: "Cet OpenSprinkler n'est plus dans la configuration : choisissez-en un autre dans les réglages du widget.",
    de: 'Dieser OpenSprinkler ist nicht mehr in der Konfiguration: Wähle einen anderen in den Widget-Einstellungen.',
    es: 'Este OpenSprinkler ya no está en la configuración: elija otro en la configuración del widget.',
  },
  noAnswer: {
    en: 'The controller does not answer: see the Configuration screen of the integration.',
    fr: "Le contrôleur ne répond pas : voir l'écran Configuration de l'intégration.",
    de: 'Die Steuerung antwortet nicht: Sieh dir die Konfiguration der Integration an.',
    es: 'El controlador no responde: consulte la pantalla de configuración de la integración.',
  },
  updateGladys: {
    en: 'Update Gladys to 5.2.0 or later to use this button.',
    fr: 'Mettez Gladys à jour (5.2.0 ou plus) pour utiliser ce bouton.',
    de: 'Aktualisiere Gladys auf 5.2.0 oder neuer, um diese Schaltfläche zu nutzen.',
    es: 'Actualice Gladys a la versión 5.2.0 o posterior para usar este botón.',
  },
  // Tiles and buttons (24 characters at most).
  waterLevel: {
    en: 'Watering level',
    fr: "Niveau d'arrosage",
    de: 'Bewässerungsstufe',
    es: 'Nivel de riego',
  },
  rainDelay: { en: 'Rain delay', fr: 'Délai de pluie', de: 'Regenpause', es: 'Retraso por lluvia' },
  flow: { en: 'Water flow', fr: "Débit d'eau", de: 'Durchfluss', es: 'Caudal' },
  runStation: { en: 'Water…', fr: 'Arroser…', de: 'Bewässern…', es: 'Regar…' },
  runProgram: { en: 'Program…', fr: 'Programme…', de: 'Programm…', es: 'Programa…' },
  stopAll: { en: 'Stop all', fr: 'Tout arrêter', de: 'Alles stoppen', es: 'Detener todo' },
  rainDelayButton: {
    en: 'Rain delay…',
    fr: 'Délai de pluie…',
    de: 'Regenpause…',
    es: 'Retraso lluvia…',
  },
  cancelRainDelay: {
    en: 'Cancel rain delay',
    fr: 'Annuler le délai',
    de: 'Regenpause beenden',
    es: 'Anular retraso',
  },
  // Status rows (40 characters at most).
  controller: { en: 'Controller', fr: 'Contrôleur', de: 'Steuerung', es: 'Controlador' },
  idle: { en: 'Idle', fr: 'Au repos', de: 'Bereit', es: 'En reposo' },
  watering: { en: 'Watering', fr: 'Arrosage en cours', de: 'Bewässert', es: 'Regando' },
  disabled: { en: 'Disabled', fr: 'Désactivé', de: 'Deaktiviert', es: 'Desactivado' },
  paused: { en: 'Paused', fr: 'En pause', de: 'Pausiert', es: 'En pausa' },
  waiting: { en: 'Waiting', fr: 'En attente', de: 'Wartet', es: 'En espera' },
  rainDetected: {
    en: 'Rain detected',
    fr: 'Pluie détectée',
    de: 'Regen erkannt',
    es: 'Lluvia detectada',
  },
  rainSensor: {
    en: 'Rain sensor',
    fr: 'Capteur de pluie',
    de: 'Regensensor',
    es: 'Sensor de lluvia',
  },
  unreachable: { en: 'Unreachable', fr: 'Injoignable', de: 'Nicht erreichbar', es: 'Inaccesible' },
  error: { en: 'Error', fr: 'Erreur', de: 'Fehler', es: 'Error' },
  more: {
    en: 'More stations',
    fr: 'Autres stations',
    de: 'Weitere Stationen',
    es: 'Más estaciones',
  },
  // Form fields (40 characters at most).
  station: { en: 'Station', fr: 'Station', de: 'Station', es: 'Estación' },
  program: { en: 'Program', fr: 'Programme', de: 'Programm', es: 'Programa' },
  minutes: {
    en: 'Duration (minutes)',
    fr: 'Durée (minutes)',
    de: 'Dauer (Minuten)',
    es: 'Duración (minutos)',
  },
  hours: {
    en: 'Duration (hours)',
    fr: 'Durée (heures)',
    de: 'Dauer (Stunden)',
    es: 'Duración (horas)',
  },
  useWeather: {
    en: 'Apply the watering level',
    fr: "Appliquer le niveau d'arrosage",
    de: 'Bewässerungsstufe anwenden',
    es: 'Aplicar el nivel de riego',
  },
};

// Toasts after a tap (≤ 200 characters).
export const DONE_TEXT = {
  en: {
    station: (name, minutes) => `${name}: watering for ${minutes} min.`,
    program: (name) => `${name} started.`,
    stopped: 'Every station stopped.',
    rainDelay: (hours) => `Watering held for ${hours} h.`,
    cancelled: 'Rain delay cancelled.',
  },
  fr: {
    station: (name, minutes) => `${name} : arrosage pendant ${minutes} min.`,
    program: (name) => `${name} lancé.`,
    stopped: 'Toutes les stations sont arrêtées.',
    rainDelay: (hours) => `Arrosage suspendu pendant ${hours} h.`,
    cancelled: 'Délai de pluie annulé.',
  },
  de: {
    station: (name, minutes) => `${name}: Bewässerung für ${minutes} min.`,
    program: (name) => `${name} gestartet.`,
    stopped: 'Alle Stationen gestoppt.',
    rainDelay: (hours) => `Bewässerung für ${hours} h ausgesetzt.`,
    cancelled: 'Regenpause beendet.',
  },
  es: {
    station: (name, minutes) => `${name}: riego durante ${minutes} min.`,
    program: (name) => `${name} iniciado.`,
    stopped: 'Todas las estaciones detenidas.',
    rainDelay: (hours) => `Riego suspendido durante ${hours} h.`,
    cancelled: 'Retraso por lluvia anulado.',
  },
};

const t = (text, language) => pick(text, language);
// A form option label must be a multi-language object: the station and program
// names are the user's own, the same in every language.
const everyLanguage = (text) => ({ en: text, fr: text, de: text, es: text });
const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}

// "12 min left", rounded up: a station with 30 s left still shows 1 min.
export const LEFT_TEXT = {
  en: (minutes) => `${minutes} min left`,
  fr: (minutes) => `encore ${minutes} min`,
  de: (minutes) => `noch ${minutes} min`,
  es: (minutes) => `quedan ${minutes} min`,
};

function remaining(seconds, language) {
  return (LEFT_TEXT[language] ?? LEFT_TEXT.en)(Math.max(1, Math.ceil(seconds / 60)));
}

function controllerRow(snapshot, language) {
  const label = t(TEXT.controller, language);
  const watering = snapshot.stations.some((station) => station.running && !station.master);
  if (!snapshot.enabled) {
    return {
      label,
      icon: 'power',
      value: t(TEXT.disabled, language),
      color: WIDGET_COLORS.WARNING,
    };
  }
  if (snapshot.paused) {
    return {
      label,
      icon: 'pause',
      value: `${t(TEXT.paused, language)} · ${Math.max(1, Math.ceil(snapshot.pauseSeconds / 60))} min`,
      color: WIDGET_COLORS.WARNING,
    };
  }
  if (watering) {
    return {
      label,
      icon: 'droplet',
      value: t(TEXT.watering, language),
      color: WIDGET_COLORS.PRIMARY,
    };
  }
  if (snapshot.rainDelay.hours > 0) {
    return {
      label,
      icon: 'umbrella',
      value: `${t(TEXT.rainDelay, language)} · ${snapshot.rainDelay.hours} h`,
      color: WIDGET_COLORS.INFO,
    };
  }
  return {
    label,
    icon: 'check-circle',
    value: t(TEXT.idle, language),
    color: WIDGET_COLORS.SUCCESS,
  };
}

/** Status rows: the controller, the rain sensor, then the busy stations. */
export function statusItems(snapshot, language) {
  const items = [controllerRow(snapshot, language)];
  const rain = snapshot.sensors.filter((sensor) => sensor.type === 'rain');
  if (rain.some((sensor) => sensor.active)) {
    items.push({
      label: t(TEXT.rainSensor, language),
      icon: 'cloud-rain',
      value: t(TEXT.rainDetected, language),
      color: WIDGET_COLORS.INFO,
    });
  }
  // The master stations follow the others: not worth a row.
  const busy = snapshot.stations.filter(
    (station) => !station.master && (station.running || station.queued),
  );
  // Watering first, then the queue in its order.
  busy.sort((a, b) => Number(b.running) - Number(a.running) || a.start - b.start);
  const room = MAX_ROWS - items.length;
  const shown = busy.length > room ? busy.slice(0, room - 1) : busy;
  for (const station of shown) {
    items.push({
      label: fit(stationName(station.name, station.index, language), 40),
      icon: station.running ? 'droplet' : 'clock',
      value: station.running ? remaining(station.remaining, language) : t(TEXT.waiting, language),
      color: station.running ? WIDGET_COLORS.PRIMARY : WIDGET_COLORS.NEUTRAL,
    });
  }
  if (shown.length < busy.length) {
    items.push({
      label: t(TEXT.more, language),
      icon: 'more-horizontal',
      value: busy.length - shown.length,
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  return items;
}

export function buttons(snapshot, language, stationMinutes) {
  const stations = snapshot.stations.filter((station) => !station.master);
  const list = [];
  if (stations.length > 0) {
    list.push({
      type: 'button',
      label: t(TEXT.runStation, language),
      icon: 'droplet',
      style: 'secondary',
      action: {
        key: ACTIONS.RUN_STATION,
        fields: [
          {
            key: 'station',
            type: 'select',
            required: true,
            default: String(stations[0].index + 1),
            label: TEXT.station,
            options: stations.map((station) => ({
              value: String(station.index + 1),
              label: everyLanguage(
                fit(
                  `${station.index + 1}. ${stationName(station.name, station.index, language)}`,
                  40,
                ),
              ),
            })),
          },
          {
            key: 'minutes',
            type: 'number',
            required: true,
            min: 1,
            max: MAX_RUN_MINUTES,
            default: stationMinutes,
            label: TEXT.minutes,
          },
        ],
      },
    });
  }
  if (snapshot.programs.length > 0) {
    list.push({
      type: 'button',
      label: t(TEXT.runProgram, language),
      icon: 'calendar',
      style: 'secondary',
      action: {
        key: ACTIONS.RUN_PROGRAM,
        fields: [
          {
            key: 'program',
            type: 'select',
            required: true,
            default: '1',
            label: TEXT.program,
            options: snapshot.programs.map((program) => ({
              value: String(program.index + 1),
              label: everyLanguage(fit(`${program.index + 1}. ${program.name ?? ''}`.trim(), 40)),
            })),
          },
          { key: 'use_weather', type: 'boolean', default: true, label: TEXT.useWeather },
        ],
      },
    });
  }
  list.push({
    type: 'button',
    label: t(TEXT.stopAll, language),
    icon: 'square',
    style: 'danger',
    action: { key: ACTIONS.STOP_ALL, confirm: true },
  });
  if (snapshot.rainDelay.hours > 0) {
    list.push({
      type: 'button',
      label: t(TEXT.cancelRainDelay, language),
      icon: 'sun',
      style: 'secondary',
      action: { key: ACTIONS.CANCEL_RAIN_DELAY },
    });
  } else {
    list.push({
      type: 'button',
      label: t(TEXT.rainDelayButton, language),
      icon: 'umbrella',
      style: 'secondary',
      action: {
        key: ACTIONS.RAIN_DELAY,
        fields: [
          {
            key: 'hours',
            type: 'number',
            required: true,
            min: 1,
            max: MAX_RAIN_DELAY_HOURS,
            default: DEFAULT_RAIN_DELAY_HOURS,
            label: TEXT.hours,
          },
        ],
      },
    });
  }
  return list;
}

async function get(hub, { settings, language = 'en' }) {
  if (hub.records.size === 0) {
    return message(TEXT.pick, language);
  }
  const record = hub.view(settings?.device);
  if (!record) {
    return message(TEXT.unknown, language);
  }
  if (!record.snapshot || record.error) {
    const unreachable = !record.error || record.error.kind === ERROR_KINDS.UNREACHABLE;
    return {
      ttl_seconds: 60,
      components: [
        { type: 'text', variant: 'body', text: t(TEXT.noAnswer, language) },
        {
          type: 'status',
          items: [
            {
              label: fit(controllerName(record.controller, record.structure), 40),
              icon: 'alert-triangle',
              value: t(unreachable ? TEXT.unreachable : TEXT.error, language),
              color: WIDGET_COLORS.DANGER,
            },
          ],
        },
      ],
    };
  }
  const snapshot = record.snapshot;
  const components = [];
  if (snapshot.waterLevel !== null) {
    components.push({
      type: 'value',
      value: snapshot.waterLevel,
      unit: '%',
      label: t(TEXT.waterLevel, language),
      icon: 'droplet',
    });
  }
  components.push({
    type: 'value',
    value: snapshot.rainDelay.hours,
    unit: 'h',
    label: t(TEXT.rainDelay, language),
    icon: 'umbrella',
    color: snapshot.rainDelay.hours > 0 ? WIDGET_COLORS.INFO : WIDGET_COLORS.NEUTRAL,
  });
  if (snapshot.flow) {
    components.push({
      type: 'value',
      value: Math.round(snapshot.flow.litersPerMinute * 10) / 10,
      unit: 'L/min',
      label: t(TEXT.flow, language),
      icon: 'activity',
    });
  }
  components.push({ type: 'status', items: statusItems(snapshot, language) });
  components.push(...buttons(snapshot, language, hub.config.stationMinutes));
  // A run counts down: refresh sooner while something waters or waits.
  const busy = snapshot.stations.some((station) => station.running || station.queued);
  return { ttl_seconds: busy ? 30 : 120, components };
}

async function action(hub, { actionKey, settings, values }) {
  const device = settings?.device || null;
  const language = hub.config?.language ?? 'en';
  const done = (render) =>
    Object.fromEntries(Object.entries(DONE_TEXT).map(([lang, text]) => [lang, render(text)]));
  const needValues = (...keys) => {
    if (!values || keys.some((key) => values[key] === undefined || values[key] === null)) {
      // A Gladys older than 5.2.0 relays the tap without the form.
      throw new Error(t(TEXT.updateGladys, language));
    }
  };
  const record = hub.view(device);

  switch (actionKey) {
    case ACTIONS.RUN_STATION: {
      needValues('station', 'minutes');
      await hub.runStation(record ? hub.deviceId(record) : device, values.station, values.minutes);
      const station = record?.snapshot?.stations[Number(values.station) - 1];
      const minutes = Math.round(Number(values.minutes));
      return {
        message: done((text) =>
          text.station(
            station ? stationName(station.name, station.index, language) : values.station,
            minutes,
          ),
        ),
      };
    }
    case ACTIONS.RUN_PROGRAM: {
      needValues('program');
      await hub.runProgram(
        record ? hub.deviceId(record) : device,
        values.program,
        values.use_weather !== false,
      );
      const program = record?.snapshot?.programs[Number(values.program) - 1];
      return { message: done((text) => text.program(program?.name ?? `#${values.program}`)) };
    }
    case ACTIONS.STOP_ALL:
      await hub.stopAll(record ? hub.deviceId(record) : device);
      return { message: done((text) => text.stopped) };
    case ACTIONS.RAIN_DELAY: {
      needValues('hours');
      await hub.setRainDelay(record ? hub.deviceId(record) : device, values.hours);
      return { message: done((text) => text.rainDelay(Math.round(Number(values.hours)))) };
    }
    case ACTIONS.CANCEL_RAIN_DELAY:
      await hub.setRainDelay(record ? hub.deviceId(record) : device, 0);
      return { message: done((text) => text.cancelled) };
    default:
      throw new Error(`Unknown action ${actionKey}`);
  }
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
