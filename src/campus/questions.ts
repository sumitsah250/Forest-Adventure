// Question bank for Campus Quest. Each pool belongs to one department; the first option
// listed is NOT necessarily the answer — `a` is the index of the correct option.

export interface Question {
  q: string;
  options: [string, string, string, string];
  a: 0 | 1 | 2 | 3;
  /** One-line explanation shown after answering. */
  why: string;
}

export type Pool = 'admission' | 'science' | 'library' | 'civil' | 'electrical' | 'computer' | 'mechanical' | 'geomatics';

export const QUESTIONS: Record<Pool, Question[]> = {
  admission: [
    { q: 'IOE Pashchimanchal Campus is a constituent campus of which university?', options: ['Kathmandu University', 'Pokhara University', 'Tribhuvan University', 'Purbanchal University'], a: 2, why: 'The Institute of Engineering (IOE) is an institute of Tribhuvan University.' },
    { q: 'The campus is in Lamachaur, in which city?', options: ['Butwal', 'Pokhara', 'Dharan', 'Bharatpur'], a: 1, why: 'Lamachaur is in the north of Pokhara, Gandaki Province.' },
    { q: 'Which "fish-tail" peak dominates the view north from Pokhara?', options: ['Machhapuchhre', 'Ama Dablam', 'Kanchenjunga', 'Lhotse'], a: 0, why: 'Machhapuchhre (6,993 m) — its twin summit looks like a fish tail.' },
    { q: 'Next in the series: 2, 6, 12, 20, 30, …', options: ['40', '42', '44', '36'], a: 1, why: 'Differences grow by 2 (4, 6, 8, 10, 12): 30 + 12 = 42. Also n(n+1) for n = 6.' },
    { q: 'What is 15% of 240?', options: ['32', '36', '30', '40'], a: 1, why: '0.15 × 240 = 36.' },
    { q: 'A bus covers 150 km in 2 h 30 min. Its average speed is:', options: ['50 km/h', '75 km/h', '60 km/h', '65 km/h'], a: 2, why: '150 km ÷ 2.5 h = 60 km/h.' },
    { q: "Which lake is Pokhara's best-known landmark?", options: ['Rara Lake', 'Phewa Lake', 'Tilicho Lake', 'Gosaikunda'], a: 1, why: 'Phewa Tal lies on the south-west side of Pokhara.' },
    { q: 'The national flower of Nepal is the:', options: ['Lotus', 'Marigold', 'Rhododendron (Lali Gurans)', 'Orchid'], a: 2, why: 'Lali Gurans, Rhododendron arboreum.' },
  ],
  science: [
    { q: 'd/dx (x³) = ?', options: ['x²', '3x²', '3x', 'x³/3'], a: 1, why: 'Power rule: d/dx xⁿ = n·xⁿ⁻¹.' },
    { q: '∫ (1/x) dx = ?', options: ['x⁻²', 'ln|x| + C', 'eˣ + C', '1/x² + C'], a: 1, why: 'The antiderivative of 1/x is the natural log of |x|.' },
    { q: 'lim (x→0) sin x / x = ?', options: ['0', '∞', '1', 'Does not exist'], a: 2, why: 'A standard limit, provable by the squeeze theorem.' },
    { q: 'The determinant of [[2, 1], [3, 4]] is:', options: ['5', '11', '8', '−5'], a: 0, why: '2·4 − 1·3 = 5.' },
    { q: 'The SI unit of force is the:', options: ['Joule', 'Pascal', 'Watt', 'Newton'], a: 3, why: '1 N = 1 kg·m/s².' },
    { q: 'Kinetic energy of a 2 kg mass moving at 3 m/s:', options: ['6 J', '9 J', '18 J', '3 J'], a: 1, why: '½·m·v² = ½ × 2 × 9 = 9 J.' },
    { q: 'Which of these is a vector quantity?', options: ['Speed', 'Mass', 'Velocity', 'Temperature'], a: 2, why: 'Velocity has magnitude and direction.' },
    { q: 'The speed of light in vacuum is about:', options: ['3 × 10⁸ m/s', '3 × 10⁶ m/s', '3 × 10⁵ m/s', '340 m/s'], a: 0, why: 'c ≈ 299,792,458 m/s. (340 m/s is sound in air.)' },
    { q: 'If z = 3 + 4i, then |z| = ?', options: ['7', '5', '1', '25'], a: 1, why: '√(3² + 4²) = 5.' },
  ],
  library: [
    { q: 'Choose the synonym of "abundant":', options: ['Scarce', 'Plentiful', 'Hidden', 'Fragile'], a: 1, why: 'Abundant means existing in large quantities.' },
    { q: 'Choose the correctly spelled word:', options: ['Accomodation', 'Acommodation', 'Accommodation', 'Accommadation'], a: 2, why: 'Double c, double m: accommodation.' },
    { q: 'Book : Library :: Painting : ?', options: ['Artist', 'Gallery', 'Canvas', 'Frame'], a: 1, why: 'Books are kept in a library; paintings in a gallery.' },
    { q: 'If all A are B and all B are C, then:', options: ['All C are A', 'Some A are not C', 'All A are C', 'No A is C'], a: 2, why: 'Syllogism: A ⊂ B ⊂ C, so A ⊂ C.' },
    { q: 'Choose the antonym of "ancient":', options: ['Old', 'Modern', 'Historic', 'Antique'], a: 1, why: 'Ancient means very old; modern is its opposite.' },
    { q: 'Which word is a noun?', options: ['Quickly', 'Beautiful', 'Knowledge', 'Run'], a: 2, why: '"Knowledge" names a thing; the others are an adverb, an adjective and a verb.' },
    { q: 'A clock shows 3:00. The angle between the hands is:', options: ['60°', '90°', '120°', '180°'], a: 1, why: 'Each hour mark is 30°; 3 × 30° = 90°.' },
  ],
  civil: [
    { q: 'The slump test of fresh concrete measures its:', options: ['Strength', 'Workability', 'Durability', 'Density'], a: 1, why: 'Slump shows how easily concrete flows and can be placed.' },
    { q: 'Nominal mix ratio (cement : sand : aggregate) for M20 concrete:', options: ['1 : 2 : 4', '1 : 1.5 : 3', '1 : 3 : 6', '1 : 1 : 2'], a: 1, why: 'M20 ≈ 1 : 1.5 : 3; M15 is 1 : 2 : 4 and M25 is 1 : 1 : 2.' },
    { q: 'Characteristic strength of concrete is tested at:', options: ['7 days', '14 days', '28 days', '90 days'], a: 2, why: 'Grade strength (e.g. 20 MPa for M20) is the 28-day cube strength.' },
    { q: 'A beam fixed at one end and free at the other is a:', options: ['Simply supported beam', 'Cantilever', 'Continuous beam', 'Propped beam'], a: 1, why: 'Cantilevers carry load to a single fixed support.' },
    { q: 'For a cantilever with a point load at the free end, maximum bending moment occurs:', options: ['At the free end', 'At mid-span', 'At the fixed support', 'Everywhere equally'], a: 2, why: 'M = P·L at the fixed end; it is zero at the free end.' },
    { q: 'Increasing the water–cement ratio (beyond what is needed) makes concrete:', options: ['Stronger', 'Weaker', 'Unchanged', 'Heavier'], a: 1, why: "Abrams' law: strength falls as the w/c ratio rises." },
    { q: 'Unit weight of plain cement concrete is about:', options: ['14 kN/m³', '24 kN/m³', '34 kN/m³', '78 kN/m³'], a: 1, why: 'PCC ≈ 24 kN/m³; reinforced ≈ 25 kN/m³; steel ≈ 78.5 kN/m³.' },
    { q: "Poisson's ratio of most structural steels is about:", options: ['0.1', '0.3', '0.5', '0.9'], a: 1, why: 'ν ≈ 0.3 for steel; 0.5 is the upper limit (incompressible).' },
  ],
  electrical: [
    { q: "Ohm's law states:", options: ['V = I / R', 'V = I · R', 'P = V / I', 'R = V · I'], a: 1, why: 'Voltage across a resistor equals current times resistance.' },
    { q: 'Two 6 Ω resistors in parallel have an equivalent resistance of:', options: ['12 Ω', '6 Ω', '3 Ω', '1.5 Ω'], a: 2, why: '(6 × 6) / (6 + 6) = 3 Ω.' },
    { q: 'The mains supply frequency in Nepal is:', options: ['50 Hz', '60 Hz', '100 Hz', '25 Hz'], a: 0, why: 'Nepal (NEA) uses 230 V, 50 Hz.' },
    { q: 'A 230 V appliance drawing 2 A consumes:', options: ['115 W', '232 W', '460 W', '920 W'], a: 2, why: 'P = V × I = 230 × 2 = 460 W (resistive load).' },
    { q: 'A transformer works on the principle of:', options: ['Self induction', 'Mutual induction', 'Electrostatics', 'Thermionic emission'], a: 1, why: 'A changing flux from the primary induces an EMF in the secondary.' },
    { q: 'The power factor of a purely resistive load is:', options: ['0', '0.5', '0.8', '1'], a: 3, why: 'Voltage and current are in phase, so cos φ = 1.' },
    { q: 'A device that converts AC into DC is a:', options: ['Inverter', 'Rectifier', 'Transformer', 'Oscillator'], a: 1, why: 'Rectifiers (diodes) convert AC to DC; inverters do the reverse.' },
    { q: 'The unit of electrical energy billed by the utility is the:', options: ['kW', 'kWh', 'kVA', 'Joule per second'], a: 1, why: '1 unit = 1 kilowatt-hour = 3.6 MJ.' },
  ],
  computer: [
    { q: 'The binary representation of decimal 10 is:', options: ['1010', '1001', '1100', '0110'], a: 0, why: '8 + 2 = 10 → 1010.' },
    { q: 'Which gate is a "universal" gate?', options: ['AND', 'OR', 'XOR', 'NAND'], a: 3, why: 'Any logic function can be built from NAND gates alone (NOR too).' },
    { q: 'The output of an XOR gate with inputs 1 and 1 is:', options: ['1', '0', 'Undefined', 'High impedance'], a: 1, why: 'XOR is 1 only when the inputs differ.' },
    { q: 'In C, what does printf("%d", 7 / 2); print?', options: ['3.5', '3', '4', '3.0'], a: 1, why: 'Integer division truncates toward zero.' },
    { q: 'Time complexity of binary search on a sorted array:', options: ['O(n)', 'O(n log n)', 'O(log n)', 'O(1)'], a: 2, why: 'Each comparison halves the remaining range.' },
    { q: 'Hexadecimal F equals decimal:', options: ['14', '15', '16', '17'], a: 1, why: 'A–F represent 10–15.' },
    { q: 'Which data structure works Last-In, First-Out?', options: ['Queue', 'Stack', 'Linked list', 'Heap'], a: 1, why: 'A stack pops the most recently pushed item first.' },
    { q: 'How many bits are in one byte?', options: ['4', '8', '16', '32'], a: 1, why: '1 byte = 8 bits.' },
  ],
  mechanical: [
    { q: 'The first law of thermodynamics is a statement of conservation of:', options: ['Mass', 'Momentum', 'Energy', 'Entropy'], a: 2, why: 'ΔU = Q − W: energy is neither created nor destroyed.' },
    { q: 'Carnot efficiency between 600 K and 300 K is:', options: ['25%', '50%', '75%', '100%'], a: 1, why: 'η = 1 − Tc/Th = 1 − 300/600 = 0.5.' },
    { q: 'A four-stroke engine has one power stroke every:', options: ['Half revolution', 'One revolution', 'Two revolutions', 'Four revolutions'], a: 2, why: 'Four strokes take two crankshaft revolutions.' },
    { q: 'The SI unit of pressure is the:', options: ['Pascal', 'Bar', 'Newton', 'Atmosphere'], a: 0, why: '1 Pa = 1 N/m². Bar and atm are non-SI units.' },
    { q: 'Which tool cuts internal threads in a drilled hole?', options: ['Die', 'Tap', 'Reamer', 'File'], a: 1, why: 'Taps cut internal threads; dies cut external ones.' },
    { q: 'The main operation done on a lathe is:', options: ['Turning', 'Shaping', 'Broaching', 'Welding'], a: 0, why: 'The workpiece rotates against a single-point tool.' },
    { q: 'Which is a hardness test?', options: ['Izod', 'Charpy', 'Brinell', 'Tensile'], a: 2, why: 'Brinell (and Rockwell, Vickers) measure hardness; Izod and Charpy measure impact toughness.' },
    { q: 'A micrometer screw gauge typically reads to:', options: ['1 mm', '0.1 mm', '0.01 mm', '1 cm'], a: 2, why: 'A standard metric micrometer has a least count of 0.01 mm.' },
  ],
  geomatics: [
    { q: 'GNSS stands for:', options: ['Global Navigation Satellite System', 'General Network Signal Service', 'Geodetic North Survey Standard', 'Global Node Sensing System'], a: 0, why: 'GPS, GLONASS, Galileo and BeiDou are all GNSS constellations.' },
    { q: 'Minimum number of satellites for a 3D GNSS position fix:', options: ['2', '3', '4', '6'], a: 2, why: 'Four unknowns: x, y, z and the receiver clock error.' },
    { q: 'An instrument that measures horizontal and vertical angles:', options: ['Planimeter', 'Theodolite', 'Hygrometer', 'Clinometer only'], a: 1, why: 'A theodolite (or a total station) measures both.' },
    { q: 'Contour lines drawn close together indicate:', options: ['A flat area', 'A steep slope', 'A river', 'A depression only'], a: 1, why: 'Closely spaced contours: height changes quickly over a short distance.' },
    { q: 'On a 1 : 50,000 map, 1 cm represents:', options: ['50 m', '500 m', '5 km', '50 km'], a: 1, why: '50,000 cm = 500 m.' },
    { q: 'A total station combines an electronic theodolite with:', options: ['A compass', 'An EDM (distance meter)', 'A barometer', 'A plane table'], a: 1, why: 'Electronic distance measurement plus angles gives full 3D coordinates.' },
    { q: 'Levelling is used to determine:', options: ['Horizontal angles', 'Differences in elevation', 'Magnetic bearing', 'Area'], a: 1, why: 'A level and staff measure height differences between points.' },
    { q: 'Pokhara lies at about which latitude?', options: ['18° N', '28° N', '38° N', '8° N'], a: 1, why: 'The campus is at about 28.25° N, 83.98° E.' },
  ],
};

export function shuffled<T>(list: readonly T[]): T[] {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
