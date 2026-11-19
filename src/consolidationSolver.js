// Επίλυση 3D στερεοποίησης: m_v·γw·∂u/∂t = ∇·(k ∇u)
// Πεπλεγμένο σχήμα (Backward Euler) σε συντηρητική μορφή: η ροή στις διεπιφάνειες
// στρώσεων υπολογίζεται με τον αρμονικό μέσο του k, οπότε διατηρείται η συνέχεια της ροής.
// Το σχήμα είναι ευσταθές για κάθε Δt, άρα δεν χρειάζεται περιορισμός του cv.
// Το γραμμικό σύστημα κάθε βήματος λύνεται με Συζυγείς Κλίσεις (PCG, Jacobi).
//
// Κάνναβος nx·ny·nz με δείκτη i = x + y·nx + z·nx·ny.
// kv, kh: διαπερατότητες (m/s), storage: γw·m_v (1/m), isDrain: 1 όπου u = 0 (Dirichlet).
// Στα πλευρικά όρια και στον πυθμένα δεν υπάρχει όψη: μηδενική ροή (Neumann).
// Το u (υπερπίεση) ενημερώνεται επί τόπου σε κάθε βήμα.
export function createImplicitSolver({ nx, ny, nz, stepX, stepY, stepZ, kv, kh, storage, isDrain, u }) {
  const nxy = nx * ny;
  const size = nxy * nz;

  // Όγκοι ελέγχου γύρω από τους κόμβους: στα όρια ο όγκος είναι μισός σε κάθε διεύθυνση.
  // Ισοδυναμεί με τους φανταστικούς κόμβους (u₋₁ = u₁ → 2(u₁ − u₀)/Δ²), οπότε το
  // αδιαπέρατο όριο βρίσκεται ακριβώς στον ακραίο κόμβο και όχι μισό βήμα πιο έξω.
  const frac = (n) => Float64Array.from({ length: n }, (_, i) => (n > 1 && (i === 0 || i === n - 1)) ? 0.5 : 1);
  const fx = frac(nx), fy = frac(ny), fz = frac(nz);

  // Αγωγιμότητες προς τον επόμενο κόμβο σε κάθε διεύθυνση (αρμονικός μέσος k / Δ², επί το
  // κλάσμα της επιφάνειας της όψης) και αποθηκευτικότητα επί το κλάσμα του όγκου
  const harm = (a, b) => (a > 0 && b > 0) ? 2 * a * b / (a + b) : 0;
  const cX = new Float64Array(size), cY = new Float64Array(size), cZ = new Float64Array(size);
  const diagK = new Float64Array(size);
  const S = new Float64Array(size);
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const i = x + y * nx + z * nxy;
        S[i] = storage[i] * fx[x] * fy[y] * fz[z];
        if (x < nx - 1) { cX[i] = harm(kh[i], kh[i + 1]) / (stepX * stepX) * fy[y] * fz[z]; diagK[i] += cX[i]; diagK[i + 1] += cX[i]; }
        if (y < ny - 1) { cY[i] = harm(kv[i], kv[i + nx]) / (stepY * stepY) * fx[x] * fz[z]; diagK[i] += cY[i]; diagK[i + nx] += cY[i]; }
        if (z < nz - 1) { cZ[i] = harm(kh[i], kh[i + nxy]) / (stepZ * stepZ) * fx[x] * fy[y]; diagK[i] += cZ[i]; diagK[i + nxy] += cZ[i]; }
      }
    }
  }

  const activeList = [];
  for (let i = 0; i < size; i++) {
    if (isDrain[i]) u[i] = 0;
    else activeList.push(i);
  }
  const active = Int32Array.from(activeList);

  const r = new Float64Array(size), zv = new Float64Array(size), p = new Float64Array(size);
  const Ap = new Float64Array(size), b = new Float64Array(size);

  // out = (S/Δt + K)·v, με v = 0 στους κόμβους στράγγισης
  const matvec = (v, out, invDt) => {
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        let i = y * nx + z * nxy;
        for (let x = 0; x < nx; x++, i++) {
          if (isDrain[i]) { out[i] = 0; continue; }
          let s = (S[i] * invDt + diagK[i]) * v[i];
          if (x > 0) s -= cX[i - 1] * v[i - 1];
          if (x < nx - 1) s -= cX[i] * v[i + 1];
          if (y > 0) s -= cY[i - nx] * v[i - nx];
          if (y < ny - 1) s -= cY[i] * v[i + nx];
          if (z > 0) s -= cZ[i - nxy] * v[i - nxy];
          if (z < nz - 1) s -= cZ[i] * v[i + nxy];
          out[i] = s;
        }
      }
    }
  };

  // Ένα βήμα Backward Euler: (S/Δt + K)·u_new = S/Δt·u_old
  return function implicitStep(dt) {
    const invDt = 1 / dt;
    let bNorm2 = 0;
    for (let k = 0; k < active.length; k++) { const i = active[k]; b[i] = S[i] * invDt * u[i]; bNorm2 += b[i] * b[i]; }
    if (bNorm2 === 0) return;

    matvec(u, Ap, invDt);
    let rz = 0;
    for (let k = 0; k < active.length; k++) {
      const i = active[k];
      r[i] = b[i] - Ap[i];
      zv[i] = r[i] / (S[i] * invDt + diagK[i]);
      p[i] = zv[i];
      rz += r[i] * zv[i];
    }
    const tol2 = 1e-14 * bNorm2;
    for (let it = 0; it < 2000; it++) {
      let rr = 0;
      for (let k = 0; k < active.length; k++) { const i = active[k]; rr += r[i] * r[i]; }
      if (rr <= tol2) break;

      matvec(p, Ap, invDt);
      let pAp = 0;
      for (let k = 0; k < active.length; k++) { const i = active[k]; pAp += p[i] * Ap[i]; }
      const alpha = rz / pAp;
      let rzNew = 0;
      for (let k = 0; k < active.length; k++) {
        const i = active[k];
        u[i] += alpha * p[i];
        r[i] -= alpha * Ap[i];
        zv[i] = r[i] / (S[i] * invDt + diagK[i]);
        rzNew += r[i] * zv[i];
      }
      const beta = rzNew / rz;
      rz = rzNew;
      for (let k = 0; k < active.length; k++) { const i = active[k]; p[i] = zv[i] + beta * p[i]; }
    }
    for (let k = 0; k < active.length; k++) { const i = active[k]; if (u[i] < 0) u[i] = 0; }
  };
}

// Χρονικοί στόχοι στιγμιοτύπων (λογαριθμικά ισαπέχοντες από firstSnapSec έως maxSec) και
// χρονικά βήματα: λογαριθμικά πυκνά (stepsPerDecade ανά δεκάδα), συν τις ακριβείς στιγμές
// των στιγμιοτύπων, ώστε κάθε στιγμιότυπο να αντιστοιχεί ακριβώς στον χρόνο του.
export function buildTimeSchedule(maxSec, numSnaps, firstSnapSec, stepsPerDecade = 30) {
  const first = Math.min(firstSnapSec, maxSec);
  const minLog = Math.log10(first);
  const maxLog = Math.log10(maxSec);
  const snapTargets = [];
  for (let i = 0; i < numSnaps; i++) {
    snapTargets.push(numSnaps > 1 ? Math.pow(10, minLog + i * (maxLog - minLog) / (numSnaps - 1)) : maxSec);
  }

  const t0 = Math.min(3600, first / 10);
  const allTimes = [...snapTargets];
  for (let lt = Math.log10(t0); lt < maxLog; lt += 1 / stepsPerDecade) allTimes.push(Math.pow(10, lt));
  allTimes.sort((a, b) => a - b);
  const times = allTimes.filter((t, i) => i === 0 || t > allTimes[i - 1] * (1 + 1e-9));
  return { snapTargets, times };
}
