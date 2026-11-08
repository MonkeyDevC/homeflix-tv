// Datos de demostración: imitan los mensajes que HFTelegram.scan() devuelve del grupo.
// Los títulos son inventados. Los comentarios siguen el formato real (pelicula#… / serie(T/E)#…).

export const CHAT_ID = -1004437120043;
export const CHAT_TITLE = 'NETSUCKS';

const Q = {
  '4K': { h: 2160, w: 3840, mbps: 18 },
  '1080p': { h: 1080, w: 1920, mbps: 6 },
  '720p': { h: 720, w: 1280, mbps: 3 },
  '360p': { h: 360, w: 640, mbps: 0.8 },
};

const MOVIES = [
  { name: 'La última estación', year: 2025, min: 128, cats: ['Drama', 'Misterio'], q: { '4K': 3, '1080p': 3, '720p': 1, '360p': 1 },
    desc: 'Un tren nocturno se detiene en una estación que no aparece en ningún mapa. Elena tiene hasta el amanecer para entender por qué todos los pasajeros la conocen.' },
  { name: 'Pequeños gigantes', year: 2026, min: 94, cats: ['Animación', 'Familia'], kids: true, q: { '1080p': 1, '720p': 1, '360p': 1 },
    desc: 'Tres hormigas valientes emprenden el viaje más largo de su vida: cruzar el jardín antes de que llegue la lluvia.' },
  { name: 'Código Ámbar', year: 2025, min: 117, cats: ['Acción', 'Ciencia_ficción'], q: { '4K': 2, '1080p': 1, '720p': 1 },
    desc: 'Una ingeniera descubre que la ciudad entera funciona con un programa que alguien está a punto de apagar.' },
  { name: 'El faro de Lucía', year: 2023, min: 102, cats: ['Drama', 'Familia'], q: { '1080p': 1, '720p': 1 },
    desc: 'Lucía vuelve al pueblo donde creció para cerrar el faro de su abuelo, pero el mar tiene otros planes.' },
  { name: 'Órbita cero', year: 2026, min: 133, cats: ['Ciencia_ficción', 'Suspenso'], q: { '4K': 3, '1080p': 2, '720p': 1, '360p': 1 },
    desc: 'La tripulación de la estación Kepler despierta sin recuerdos y con una cuenta regresiva en todas las pantallas.' },
  { name: 'Bosque de papel', year: 2024, min: 88, cats: ['Animación'], kids: true, q: { '1080p': 1, '360p': 1 },
    desc: 'Cuando los dibujos de Tomás cobran vida, el bosque de su cuaderno se convierte en el lugar más divertido del mundo.' },
  { name: 'Noche de cometas', year: 2025, min: 97, cats: ['Comedia', 'Familia'], kids: true, q: { '1080p': 1, '720p': 1 },
    desc: 'Una familia muy desordenada intenta ver la lluvia de estrellas del siglo sin pelearse. No será fácil.' },
  // Sin «#» después del año: la tolerancia toma el resto como descripción.
  { name: 'Rumbo al norte', year: 2022, min: 81, cats: ['Aventura', 'Documental'], noHash: true, q: { '1080p': 1, '720p': 1 },
    desc: 'Dos hermanos recorren la costa en bicicleta, de punta a punta, con lo justo en la mochila.' },
  { name: 'Sombras en Valparaíso', year: 2024, min: 109, cats: ['Suspenso', 'Misterio'], q: { '1080p': 2, '720p': 1 },
    desc: 'Un fotógrafo encuentra en sus negativos a una mujer que nunca estuvo frente a su cámara.' },
  { name: 'La receta de la abuela', year: 2023, min: 92, cats: ['Comedia'], q: { '1080p': 1, '720p': 1, '360p': 1 },
    desc: 'Cuatro primos compiten por heredar el restaurante familiar. La única regla: cocinar el plato secreto de la abuela.' },
  { name: 'Marea alta', year: 2025, min: 121, cats: ['Acción', 'Aventura'], q: { '4K': 3, '1080p': 2 },
    desc: 'Un equipo de rescate tiene una sola noche para sacar a un pueblo entero antes de que llegue la tormenta.' },
  { name: 'Viento del sur', year: 2024, min: 99, cats: ['Aventura', 'Familia'], kids: true, q: { '1080p': 1, '720p': 1 },
    desc: 'Una niña y su caballo cruzan la Patagonia siguiendo un mapa que dejó su madre.' },
];

const SERIES = [
  { name: 'Casa Solar', cats: ['Drama'], desc: 'Tres generaciones de una familia comparten una casa enorme, un huerto y demasiados secretos.',
    seasons: [
      ['La llegada', 'Lo que dejó el invierno', 'Cosecha'],
      ['Raíces', 'El pozo'],
    ], min: 46 },
  { name: 'Los Exploradores del Patio', cats: ['Animación'], kids: true, desc: 'Cada tarde, Mila y sus amigos convierten el patio del edificio en una expedición nueva.',
    seasons: [['El volcán de arena', 'La cueva del gato', 'Tormenta de hojas', 'El tesoro del árbol']], min: 22 },
  { name: 'Frecuencia', cats: ['Ciencia_ficción', 'Suspenso'], desc: 'Una radio vieja capta transmisiones de una ciudad que todavía no existe.',
    seasons: [['Señal', 'Interferencia', 'Silencio']], min: 52 },
];

const EP_DESC = [
  'Nada vuelve a ser igual después de esta noche.',
  'Un viejo conocido regresa con malas noticias.',
  'Las piezas empiezan a encajar, pero el precio es alto.',
  'Una decisión inesperada lo cambia todo.',
];

const tag = (c) => c.map((x) => ` #${x}`).join('');

export function demoItems() {
  const items = [];
  let msgId = 1000;
  const base = Math.floor(Date.UTC(2026, 9, 1) / 1000);
  const push = (o) => {
    msgId += 1;
    items.push({ key: `${CHAT_ID}:${msgId}`, chatId: CHAT_ID, chatTitle: CHAT_TITLE, msgId, date: base + msgId * 3600, ...o });
  };

  MOVIES.forEach((m, i) => {
    const head = `pelicula#${m.name} (${m.year})`;
    const body = m.noHash ? `${head} ${m.desc}` : `${head}#${m.desc}`;
    const caption = body + tag(m.cats) + (m.kids ? ' #infantil' : '');
    for (const [q, pieces] of Object.entries(m.q)) {
      const spec = Q[q];
      const total = m.min * 60;
      for (let p = 1; p <= pieces; p += 1) {
        const dur = Math.round(total / pieces);
        const suffix = pieces > 1 ? ` parte ${p} de ${pieces}` : '';
        push({
          kind: 'video', caption,
          fileName: `${m.name} (${m.year}) [${q}]${suffix}.mp4`,
          duration: dur, size: Math.round((dur * spec.mbps * 1e6) / 8), width: spec.w, height: spec.h,
        });
      }
    }
    push({ kind: 'photo', caption: `${head} #portada`, fileName: '', width: 1280, height: 720 });
    push({ kind: 'photo', caption: `${head} #banner`, fileName: '', width: 1920, height: 1080 });
    msgId += i; // fechas variadas
  });

  SERIES.forEach((s) => {
    s.seasons.forEach((eps, si) => {
      eps.forEach((title, ei) => {
        const T = si + 1; const E = ei + 1;
        const caption = `serie(${T}/${E})#${s.name}#${title}#${EP_DESC[(si + ei) % EP_DESC.length]}` + tag(s.cats) + (s.kids ? ' #infantil' : '');
        for (const q of ['1080p', '720p']) {
          const spec = Q[q]; const dur = s.min * 60 + ei * 37;
          push({ kind: 'video', caption, fileName: `${s.name} T${T}E${E} [${q}].mp4`, duration: dur, size: Math.round((dur * spec.mbps * 1e6) / 8), width: spec.w, height: spec.h });
        }
      });
    });
    push({ kind: 'photo', caption: `serie#${s.name}#${s.desc} #portada`, fileName: '', width: 1280, height: 720 });
    push({ kind: 'photo', caption: `serie#${s.name} #banner`, fileName: '', width: 1920, height: 1080 });
  });

  // Un mensaje que no sigue el formato: queda en «sin clasificar».
  push({ kind: 'video', caption: 'video de la fiesta', fileName: 'VID_2026.mp4', duration: 95, size: 42e6, width: 1280, height: 720 });
  return items;
}
