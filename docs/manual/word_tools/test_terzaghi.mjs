// Έλεγχος του πεπλεγμένου επιλυτή έναντι της αναλυτικής λύσης Terzaghi (1D, μονόπλευρη στράγγιση)
import { pathToFileURL } from 'node:url';
const solverPath = process.argv[2];
const NY = Number(process.argv[3] || 21);
const { createImplicitSolver, buildTimeSchedule } = await import(pathToFileURL(solverPath).href);

const terzaghiU = (Tv) => {
  let s = 0;
  for (let m = 0; m < 200; m++) { const M = Math.PI * (2 * m + 1) / 2; s += (2 / (M * M)) * Math.exp(-M * M * Tv); }
  return 1 - s;
};

function run({ ny, drainBottom = false }) {
  const nx = 3, nz = 3, H = 20;
  const stepY = H / (ny - 1), stepX = 1, stepZ = 1;
  const size = nx * ny * nz;
  const k = 1e-9, mv = 1e-3, GW = 9.81;
  const kv = new Float64Array(size).fill(k), kh = new Float64Array(size).fill(k);
  const storage = new Float64Array(size).fill(GW * mv);
  const isDrain = new Uint8Array(size);
  const u = new Float64Array(size).fill(1);
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    isDrain[x + (ny - 1) * nx + z * nx * ny] = 1;          // επιφάνεια
    if (drainBottom) isDrain[x + z * nx * ny] = 1;         // βάση
  }
  const step = createImplicitSolver({ nx, ny, nz, stepX, stepY, stepZ, kv, kh, storage, isDrain, u });
  const cv = k / (GW * mv);
  const Hdr = drainBottom ? H / 2 : H;
  const TvList = [0.01, 0.05, 0.1, 0.2, 0.5, 1.0];
  const targets = TvList.map(Tv => Tv * Hdr * Hdr / cv);
  const { times } = buildTimeSchedule(targets[targets.length - 1], 40, targets[0]);
  const all = [...new Set([...times, ...targets])].sort((a, b) => a - b);

  const Uavg = () => {
    // Μέσος βαθμός με τραπεζοειδή ολοκλήρωση της u (στήλη x=1, z=1)
    let s = 0;
    for (let y = 0; y < ny - 1; y++) {
      const a = u[1 + y * nx + nx * ny], b = u[1 + (y + 1) * nx + nx * ny];
      s += 0.5 * (a + b) * stepY;
    }
    return 1 - s / H;
  };

  let t = 0, ti = 0;
  const rows = [];
  for (const tt of all) {
    step(tt - t); t = tt;
    if (ti < targets.length && Math.abs(t - targets[ti]) < 1e-6 * t) {
      const num = Uavg(), ana = terzaghiU(TvList[ti]);
      rows.push({ Tv: TvList[ti], numerical: +(num * 100).toFixed(2), terzaghi: +(ana * 100).toFixed(2), diff: +((num - ana) * 100).toFixed(2) });
      ti++;
    }
  }
  return rows;
}

console.log('Μονόπλευρη στράγγιση, ny=21 (όπως στην εφαρμογή):');
console.table(run({ ny: NY }));
console.log('Αμφίπλευρη στράγγιση, ny=21:');
console.table(run({ ny: NY, drainBottom: true }));
