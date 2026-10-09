// Advent of Code 2024 as an advent calendar. Each door hides that day's video
// walkthrough; hovering (or focusing) a door opens it and shows what the puzzle
// asked, and clicking plays the video. Titles and links come from the puzzle
// pages and the repo README; the topics are the ones named in the video titles.

const IMG = new URL('../../img/aoc/', import.meta.url);
const REPO = 'https://github.com/FelixCenusa/Advent-Of-Code-2024';

// [title, part one, part two, topics, YouTube id]
export const DAYS = [
  ['Historian Hysteria', 'Two lists of location IDs: pair them up smallest to smallest and add up how far apart each pair is.', 'Score how similar the lists are by counting how often each left number appears on the right.', [], 'k8Y0BJ5x6hM'],
  ['Red-Nosed Reports', 'Decide which reports are safe: the levels must keep rising or keep falling, by 1 to 3 at a time.', 'A report also passes if removing any one level makes it safe.', ['Time complexity'], 'tXJZVMjXyGI'],
  ['Mull It Over', 'Dig the valid mul(X,Y) instructions out of corrupted memory and add up the products.', 'do() and don’t() instructions switch the multiplications on and off.', ['Linear time'], 'uzKFHktD4K8'],
  ['Ceres Search', 'Count every XMAS in a word search: across, down, backwards and diagonally.', 'Count two MAS words crossing in the shape of an X instead.', [], 'tynHGBGeaW4'],
  ['Print Queue', 'Check each print job against “page X before page Y” rules and add up the middle pages of the valid ones.', 'Put the invalid jobs in the right order first, then do the same.', [], 'eTS3BcUsqAY'],
  ['Guard Gallivant', 'A guard walks forward and turns right at every obstacle. Count the cells it visits before it leaves the map.', 'Find every spot where one new obstacle would trap the guard in a loop.', [], 'Q1BAvmIPFdo'],
  ['Bridge Repair', 'Put + or × between the numbers, evaluated left to right, and find which equations can hit their target.', 'Add a third operator that joins two numbers’ digits together.', ['Recursion'], 'nJivVmfWx2k'],
  ['Resonant Collinearity', 'Two antennas on the same frequency create antinodes at mirrored distances. Count them on the map.', 'Every grid point in line with two matching antennas counts.', [], 'cWeo0ezGIo8'],
  ['Disk Fragmenter', 'Compact a disk by moving file blocks into the leftmost free space, then compute its checksum.', 'Move whole files instead of single blocks.', [], 'RRqZ8IVY-QA'],
  ['Hoof It', 'Find the hiking trails on a height map that climb from 0 to 9 one step at a time, and score each trailhead by the peaks it reaches.', 'Rate each trailhead by how many distinct trails start there.', [], '-q5F03Zul-o'],
  ['Plutonian Pebbles', 'Every blink, each stone changes: 0 becomes 1, numbers with an even count of digits split in two, the rest are multiplied by 2024. Count the stones after 25 blinks.', 'Count them after 75 blinks, far too many to simulate one by one.', ['Recursion', 'Caching'], 'jR-_Dxw9tKk'],
  ['Garden Groups', 'Find each region of matching plants on a map and price its fence as area × perimeter.', 'Price it as area × number of straight sides instead.', ['Edges and areas'], 'DMy4Qcc7skE'],
  ['Claw Contraption', 'Work out how many presses of buttons A and B land each claw on its prize, for the fewest tokens.', 'The prizes move ten trillion units further away, so it becomes a pair of equations to solve.', ['Equations'], '3_H6tdcFxN4'],
  ['Restroom Redoubt', 'Robots move across a 101 × 103 grid that wraps at the edges. Multiply how many end up in each quadrant after 100 seconds.', 'Find the second when they line up into a picture of a Christmas tree.', [], 'DgyPgwe2YgE'],
  ['Warehouse Woes', 'A robot pushes rows of boxes around a warehouse. Add up the boxes’ GPS coordinates once it has finished.', 'Everything is twice as wide, so one push can move a whole branching pile of boxes.', [], 'AY84L0DVMsI'],
  ['Reindeer Maze', 'Find the cheapest way through a maze where each step costs 1 and each 90° turn costs 1000.', 'Count the tiles that lie on at least one of the cheapest paths.', ['Dijkstra', 'Priority queue'], 'Th0TGkk7PAg'],
  ['Chronospatial Computer', 'Run a program on a tiny 3-bit computer with three registers and eight instructions.', 'Find the starting value that makes the program print a copy of itself.', ['Quine'], 'DGu3KGiTH2k'],
  ['RAM Run', 'Bytes fall into a 71 × 71 memory grid. Find the shortest path to the exit after the first 1024 have landed.', 'Find the first byte that cuts the exit off completely.', ['Binary search', 'Priority queue'], '0oQ2wJSKbZ0'],
  ['Linen Layout', 'Decide which towel designs can be made by joining the available stripe patterns.', 'Count every way each design can be made.', ['Recursion', 'Caching'], 'tLyYkqFBxK4'],
  ['Race Condition', 'On a single-track racetrack you may cheat once by passing through walls for 2 picoseconds. Count the cheats that save at least 100.', 'Cheats can now last up to 20 picoseconds.', [], 'jna9XsNJvuM'],
  ['Keypad Conundrum', 'Type door codes through a chain of robots, each pressing a directional keypad for the next. Find the fewest button presses.', 'Now there are 25 robots on directional keypads.', [], 'mpgKy7Wcy24'],
  ['Monkey Market', 'Evolve each buyer’s secret number 2000 times with a mix-and-prune pseudorandom step and add up the results.', 'Find the run of four price changes that sells for the most bananas across all buyers.', [], 'bgZZYewSf70'],
  ['LAN Party', 'In a map of network links, find every group of three connected computers where one name starts with t.', 'Find the largest group where every computer links to every other one: the LAN party.', ['Graphs'], 'F1iPrxIu7Os'],
  ['Crossed Wires', 'Simulate a circuit of AND, OR and XOR gates and read the number on the z wires.', 'The circuit is a broken adder: find the four pairs of output wires that were swapped.', [], 'NVDTzmTdK0U'],
  ['Code Chronicle', 'Count the lock and key pairs whose pin heights fit together without overlapping.', 'The 50th star, unlocked by finishing every other puzzle.', [], 'PFRv-sKFLUw'],
];

const pad = (n) => String(n).padStart(2, '0');
const folder = (n) => `${REPO}/tree/main/Day-${pad(n)}-Challenge${n === 25 ? '-Final' : ''}`;
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const arrow = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M3 9l6-6M4 3h5v5"/></svg>';

export function mount(root, { reducedMotion = false } = {}) {
  const uid = 'aoc-' + Math.random().toString(36).slice(2, 7);
  root.classList.add('demo--aoc');
  root.innerHTML = `
    <div class="aoc">
      <div class="aoc__cal">
        <div class="aoc__head"><span class="aoc__month">December 2024</span><span class="aoc__legend"><i class="star"></i>one per solved part</span></div>
        <div class="aoc__doors" role="tablist" aria-label="Advent of Code 2024, days 1 to 25">
          ${DAYS.map(([title], i) => `
          <button class="aoc__door" type="button" role="tab" id="${uid}-d${i + 1}" aria-controls="${uid}-panel" aria-selected="false" tabindex="-1" data-day="${i + 1}" aria-label="Day ${i + 1}: ${esc(title)}">
            <span class="aoc__behind"><img src="${new URL(`d${pad(i + 1)}-s.webp`, IMG)}" alt="" width="256" height="144" loading="lazy" decoding="async"></span>
            <span class="aoc__leaf"><span class="aoc__n">${i + 1}</span><span class="aoc__stars" aria-hidden="true"><i class="star"></i>${i < 24 ? '<i class="star"></i>' : ''}</span></span>
          </button>`).join('')}
        </div>
        <p class="aoc__hint"><span class="mouse">Hover a door to open it, click to watch the walkthrough.</span><span class="touch">Tap a door to open it, tap it again to watch.</span></p>
      </div>
      <div class="aoc__panel" role="tabpanel" id="${uid}-panel" tabindex="-1">
        <button class="aoc__media" type="button" data-yt="" data-cap="">
          <img class="aoc__thumb" alt="" width="640" height="360" decoding="async">
          <span class="aoc__play" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M7 4.8v10.4L15.5 10z" fill="currentColor"/></svg></span>
          <span class="aoc__badge">Video walkthrough</span>
        </button>
        <div class="aoc__info">
          <p class="aoc__day"></p>
          <h4 class="aoc__title"></h4>
          <p class="aoc__task"></p>
          <p class="aoc__twist"><b>Part two</b> <span></span></p>
          <ul class="aoc__topics"></ul>
          <div class="aoc__links">
            <a class="link ext" data-l="yt" target="_blank" rel="noopener">YouTube${arrow}</a>
            <a class="link ext" data-l="code" target="_blank" rel="noopener">Code${arrow}</a>
            <a class="link ext" data-l="puzzle" target="_blank" rel="noopener">Puzzle${arrow}</a>
          </div>
        </div>
      </div>
    </div>`;

  const doors = [...root.querySelectorAll('.aoc__door')];
  const panel = root.querySelector('.aoc__panel');
  const media = root.querySelector('.aoc__media');
  const thumb = root.querySelector('.aoc__thumb');
  const info = root.querySelector('.aoc__info');
  const q = (s) => root.querySelector(s);
  let selected = 0;

  function show(n, { focus = false } = {}) {
    if (n === selected) { if (focus) doors[n - 1].focus(); return; }
    const prev = selected;
    selected = n;
    const [title, task, twist, topics, id] = DAYS[n - 1];
    doors.forEach((d, i) => {
      const on = i === n - 1;
      d.setAttribute('aria-selected', String(on));
      d.tabIndex = on ? 0 : -1;
      d.classList.toggle('is-open', on);
    });
    if (focus) doors[n - 1].focus();
    panel.setAttribute('aria-labelledby', `${uid}-d${n}`);

    // keep the small, already-loaded thumbnail underneath while the large one arrives
    media.style.backgroundImage = `url("${new URL(`d${pad(n)}-s.webp`, IMG)}")`;
    thumb.classList.remove('is-in');
    thumb.onload = () => thumb.classList.add('is-in');
    thumb.src = new URL(`d${pad(n)}.webp`, IMG).href;
    if (thumb.complete && thumb.naturalWidth) thumb.classList.add('is-in');
    media.dataset.yt = id;
    media.dataset.cap = `Advent of Code 2024, day ${n}: ${title}`;
    media.setAttribute('aria-label', `Play the day ${n} walkthrough, ${title}`);

    q('.aoc__day').textContent = `Day ${n}`;
    q('.aoc__title').textContent = title;
    q('.aoc__task').textContent = task;
    q('.aoc__twist span').textContent = twist;
    q('.aoc__twist b').textContent = n === 25 ? 'And then' : 'Part two';
    const ul = q('.aoc__topics');
    ul.replaceChildren(...topics.map((t) => Object.assign(document.createElement('li'), { className: 'tag', textContent: t })));
    ul.hidden = !topics.length;
    q('[data-l="yt"]').href = `https://youtu.be/${id}`;
    q('[data-l="code"]').href = folder(n);
    q('[data-l="puzzle"]').href = `https://adventofcode.com/2024/day/${n}`;

    if (prev && !reducedMotion && info.animate) {
      info.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
    }
  }

  // hover opens a door after a short dwell, so sweeping the pointer across the
  // calendar on the way to the panel doesn't change what the panel shows
  let dwell = 0, lastPointer = 'mouse';
  root.addEventListener('pointerover', (e) => {
    const d = e.target.closest('.aoc__door');
    if (!d || e.pointerType === 'touch') return;
    clearTimeout(dwell);
    dwell = setTimeout(() => show(+d.dataset.day), 90);
  });
  root.addEventListener('pointerout', (e) => {
    const d = e.target.closest('.aoc__door');
    if (d && !d.contains(e.relatedTarget)) clearTimeout(dwell);
  });
  root.addEventListener('pointerdown', (e) => { lastPointer = e.pointerType || 'mouse'; });
  root.addEventListener('click', (e) => {
    const d = e.target.closest('.aoc__door');
    if (!d) return;
    clearTimeout(dwell);
    const n = +d.dataset.day;
    // touch: the first tap opens the door, the second plays; mouse and keyboard play straight away
    if (lastPointer === 'touch' && n !== selected) { show(n); return; }
    show(n);
    media.click();
  });
  root.addEventListener('keydown', (e) => {
    const d = e.target.closest('.aoc__door');
    if (!d) return;
    const n = +d.dataset.day;
    const cols = getComputedStyle(root.querySelector('.aoc__doors')).gridTemplateColumns.split(' ').length || 5;
    const to = { ArrowRight: n + 1, ArrowLeft: n - 1, ArrowDown: n + cols, ArrowUp: n - cols, Home: 1, End: 25 }[e.key];
    if (to == null) return;
    e.preventDefault();
    show(Math.min(25, Math.max(1, to)), { focus: true });
  });
  lastPointer = 'mouse';

  // open on today's door in December, otherwise on day 1
  const now = new Date();
  show(now.getMonth() === 11 && now.getDate() <= 25 ? now.getDate() : 1);

  return {
    destroy() { clearTimeout(dwell); root.replaceChildren(); },
  };
}
