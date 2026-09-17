/**
 * Drafted course material for the MCSE501 / MCSE502 seed (`prisma/seed-courses.ts`).
 *
 * ## What this file is, and what it is not
 *
 * It is the **content** half of the course seed: the per-module and per-experiment text that
 * becomes course-wide `Material` rows. Keeping it apart from the seed's orchestration keeps the
 * entry point readable and keeps this file a pure data module — it imports nothing, so it cannot
 * drag the `server-only` sentinel (or anything else) into the seed's import graph.
 *
 * It is **not** a substitute syllabus. The two courses prescribe one textbook — Cormen,
 * Leiserson, Rivest & Stein, *Introduction to Algorithms*, 4th edition, MIT Press, 2022
 * ("CLRS" below) — and that book cannot source the whole of either syllabus. The owner's
 * decision was to **record that explicitly in the data** rather than invent content and label it
 * as CLRS-sourced, so every module below says which of the handbook's named topics the
 * prescribed text does cover and which it does not.
 *
 * ## Coverage was verified, not assumed
 *
 * The gap list a prior study produced was checked against the actual text and index of CLRS 4th
 * ed. before being written down, and several of its claims did not survive that check:
 *
 * - **Borůvka's algorithm** *does* appear in CLRS 4th ed. — described in the notes to Chapter 21
 *   (p. 603) with a pointer to the MST-REDUCE procedure of Problem 21-2, but as a note rather
 *   than a taught algorithm.
 * - **Fibonacci heaps** appear in the chapter notes and as a mergeable-heap exercise (p. 478),
 *   not as a chapter.
 * - **Push-relabel** is named only in the notes to Chapter 24 (p. 703); it is not developed.
 * - **The simplex algorithm** is taught (Chapter 29, p. 857) — only the **Big-M** presentation of
 *   it is absent.
 * - **Minimum-cost flow** is *formulated* in §29.2 but CLRS says in as many words that it "won't
 *   describe the algorithm", so the cycle-cancelling method is absent.
 * - **2-3 trees** and **splay trees** are mentioned in the notes (pp. 358–359, 478);
 *   **red-black trees** are a full chapter (13).
 * - **Graph colouring** appears only as NP-completeness exercises (Problem 34-3 and the
 *   appendix problem B-1); **job sequencing with deadlines** appears nowhere.
 * - **Karatsuba's algorithm** appears only in a bibliographic note beside Strassen's method; it
 *   is not developed.
 * - **Bitonic sort** has no home: CLRS 4th ed. has **no sorting-networks chapter** at all, and its
 *   only "bitonic" material is the bitonic Euclidean travelling-salesperson problem (Problem
 *   14-3) and bitonic shortest paths (Problem 22-6).
 * - **Computational geometry** was **removed** from the 4th edition entirely, so line-segment
 *   intersection, convex hull, Graham's scan and Jarvis's march have no home.
 *
 * ## Ligature repair
 *
 * The extracted text this was drafted from comes from `pdftotext`, which corrupts the `fi`/`fl`
 * ligatures into `û`/`ü`/`ﬁ` (so the raw text reads `sufûx`, `ünite automata`, `ﬂow`). Nothing
 * is copied verbatim, and every term below is written in repaired spelling. Where CLRS's own
 * name differs from the handbook's, both are given (`CIRCUIT-SAT` for "circuit satisfiability",
 * `3-CNF-SAT` for "SAT 3CNF").
 */

/** One lecture module of a theory course. `hours` is the handbook's, not a choice. */
export type ModuleMaterial = {
  module: number
  title: string
  hours: number
  contentText: string
}

/** One of a lab course's twelve *indicative* experiments. */
export type ExperimentMaterial = {
  experiment: number
  title: string
  contentText: string
}

const TEXT_BASIS =
  "Prescribed text: Cormen, Leiserson, Rivest & Stein, Introduction to Algorithms, 4th edition, MIT Press, 2022."

function paragraphs(...parts: string[]): string {
  return parts.join("\n\n")
}

// ---------------------------------------------------------------------------
// MCSE501L — Data Structures and Algorithms (theory)
// ---------------------------------------------------------------------------

export const DSA_THEORY_MODULES: ModuleMaterial[] = [
  {
    module: 1,
    title: "Growth of Functions",
    hours: 3,
    contentText: paragraphs(
      TEXT_BASIS,
      "Module scope (handbook): overview and importance of algorithms and data structures; algorithm specification; recursion; performance analysis; asymptotic notation — Big-O, Omega and Theta; programming style; refinement of coding; time-space trade-off; testing; data abstraction.",
      "Covered by the prescribed text. Algorithm specification and the analysis of running times are the subject of Chapter 2, and asymptotic notation — O, Omega and Theta — is defined formally in Chapter 3 (§3.1 for the notation, §3.2 for the formal definitions, §3.3 for standard notations and common functions). Recursion is treated through the divide-and-conquer recurrences of Chapter 4, where the substitution, recursion-tree and master methods all assume a recursive formulation.",
      "Not covered by the prescribed text. The handbook's software-engineering items — programming style, refinement of coding and testing — have no treatment in CLRS 4th ed.; its nearest material is the pseudocode conventions at the front of the book and the use of loop invariants to argue correctness (Chapter 2), which is not the same subject. Data abstraction is likewise absent as a named topic; the text introduces abstract data types implicitly through stacks, queues and linked lists in Chapter 10. Time-space trade-off is discussed in passing (for example, the linear-time sorts of Chapter 8 buy their speed with extra memory) but has no dedicated section.",
    ),
  },
  {
    module: 2,
    title: "Elementary Data Structures",
    hours: 6,
    contentText: paragraphs(
      TEXT_BASIS,
      "Module scope (handbook): array, stack, queue, linked list and its types; various representations; operations and applications of linear data structures.",
      "Covered by the prescribed text. Chapter 10 covers this module directly: §10.1 simple array-based data structures — arrays, matrices, stacks and queues — §10.2 linked lists (singly and doubly linked, with and without sentinels), and §10.3 representing rooted trees. The operations (push, pop, enqueue, dequeue, insert, delete, search) are given as pseudocode with running-time analyses.",
      "Applications are covered in context rather than as a catalogue: CLRS uses stacks for depth-first search and queues for breadth-first search in Chapter 20, and a doubly linked list for the disjoint-set linked-list representation in §19.2. The handbook's phrase \"and its types\" maps onto the text's singly linked, doubly linked and circular (sentinel) forms.",
    ),
  },
  {
    module: 3,
    title: "Sorting and Searching",
    hours: 7,
    contentText: paragraphs(
      TEXT_BASIS,
      "Module scope (handbook): insertion sort; merge sort; sorting in linear time; lower bounds for sorting; radix sort; bitonic sort; cocktail sort; medians and order statistics (minimum and maximum, selection in expected linear time, selection in worst-case linear time); linear search; interpolation search; exponential search.",
      "Covered by the prescribed text. Insertion sort is §2.1 and merge sort §2.3; quicksort and heapsort fill Chapters 6 and 7. Lower bounds for sorting are §8.1, counting sort §8.2, radix sort §8.3 and bucket sort §8.4. Medians and order statistics are Chapter 9 (§9.1 minimum and maximum, §9.2 selection in expected linear time, §9.3 selection in worst-case linear time). Linear search is Exercise 2.1-4 and is used as the running example of worst-case analysis in Chapter 2.",
      'Not covered by the prescribed text. Bitonic sort has no home: CLRS 4th ed. has no chapter on sorting networks, and the only "bitonic" material in the book is the bitonic Euclidean travelling-salesperson problem (Problem 14-3) and bitonic shortest paths (Problem 22-6), neither of which is a sorting algorithm. Cocktail sort is absent. Interpolation search is absent; the text\'s search material is linear search, the binary-search-tree operations of Chapter 12, and the selection algorithms of Chapter 9. Exponential search is absent as a search algorithm — the only occurrence of the phrase in CLRS is the *exponential search tree*, a different data structure mentioned in the notes to §17.5 (p. 478).',
    ),
  },
  {
    module: 4,
    title: "Trees",
    hours: 6,
    contentText: paragraphs(
      TEXT_BASIS,
      "Module scope (handbook): binary trees and their properties; B-tree; B-tree definition; operations on B-trees — searching, creating, splitting, inserting and deleting; B+-tree.",
      "Covered by the prescribed text. Binary trees and their properties are covered by §10.3 (representing rooted trees) together with Appendix B.5, and binary *search* trees are Chapter 12. B-trees are Chapter 18: §18.1 defines them, §18.2 gives the basic operations (search, create, split, insert) and §18.3 deletion, which is exactly the handbook's operation list.",
      "Not covered by the prescribed text. The B+-tree has no home in CLRS 4th ed. — the chapter treats B-trees only, and its insertion and deletion are for the variant that stores records at every node. B+-trees (records only at the leaves, with a linked leaf level) belong to the database-systems literature; the syllabus's prescribed text does not cover them and no substitute is offered here.",
    ),
  },
  {
    module: 5,
    title: "Advanced Trees",
    hours: 8,
    contentText: paragraphs(
      TEXT_BASIS,
      "Module scope (handbook): threaded binary trees; leftist trees; tournament trees; 2-3 tree; splay tree; red-black trees; range trees.",
      "Covered by the prescribed text. Red-black trees are Chapter 13 in full — properties (§13.1), rotations (§13.2), insertion (§13.3) and deletion (§13.4) — together with the height bound that makes them balanced. Augmenting data structures, which is how the book adds order statistics and interval queries to a red-black tree, is Chapter 17.",
      "Mentioned but not taught by the prescribed text. 2-3 trees appear only in the chapter notes (pp. 358–359) and an exercise (p. 519); splay trees appear only in the notes (pp. 359, 478). Neither has a section in CLRS 4th ed.",
      'Not covered by the prescribed text at all. Threaded binary trees, leftist trees, tournament trees and range trees have no home in CLRS 4th ed. The nearest CLRS material for each is recorded rather than substituted: the augmenting-data-structures chapter (17) covers interval trees and order-statistic trees, not range trees; and mergeable heaps (leftist heaps, binomial heaps, Fibonacci heaps) are left to Problem 10-2 and the chapter notes, not developed. The term "tournament tree" does not appear.',
    ),
  },
  {
    module: 6,
    title: "Graphs",
    hours: 7,
    contentText: paragraphs(
      TEXT_BASIS,
      "Module scope (handbook): representation of graphs; topological sorting; shortest-path algorithms — Dijkstra's algorithm and the Floyd-Warshall algorithm; minimum spanning trees — reverse-delete algorithm and Borůvka's algorithm.",
      "Covered by the prescribed text. Representations of graphs are §20.1, breadth-first search §20.2, depth-first search §20.3 and topological sort §20.4. Single-source shortest paths are Chapter 22 (Dijkstra is §22.3, and the Bellman-Ford algorithm of §22.1 covers the negative-weight case the handbook does not name). All-pairs shortest paths are Chapter 23, with the Floyd-Warshall algorithm as §23.2. Minimum spanning trees are Chapter 21: §21.1 establishes the greedy characterisation (the cut and cycle properties) and §21.2 gives the algorithms of Kruskal and Prim.",
      "Present only in the chapter notes. Borůvka's algorithm is described in the notes to Chapter 21 (p. 603), which point to the MST-REDUCE procedure of Problem 21-2; the chapter's own sections teach only Kruskal and Prim.",
      "Not covered by the prescribed text. The reverse-delete algorithm has no home in CLRS 4th ed. The book's MST treatment is Kruskal and Prim, with Borůvka left to the exercise named above; reverse-delete is taught in other algorithm texts but appears nowhere in the prescribed one.",
    ),
  },
  {
    module: 7,
    title: "Heap and Hashing",
    hours: 6,
    contentText: paragraphs(
      TEXT_BASIS,
      "Module scope (handbook): heaps as priority queues; binary heaps; binomial and Fibonacci heaps; heaps in Huffman coding; extendible hashing.",
      "Covered by the prescribed text. Binary heaps are Chapter 6, and §6.5 presents them as priority queues supporting insert, minimum, extract-min and decrease-key. Heaps in Huffman coding are §15.3, where the algorithm is built on a min-priority queue. Hashing is Chapter 11 — direct-address tables (§11.1), hash tables and chaining (§11.2), hash functions (§11.3, including universal hashing) and open addressing (§11.4).",
      "Present only in the notes and exercises. Fibonacci heaps appear in the notes to Chapter 19 (p. 478) and as the mergeable-heap problem (Problem 10-2), where the reader is asked to implement mergeable heaps; the book does not develop them, nor does it analyse their amortized bounds in a section.",
      'Not covered by the prescribed text. Binomial heaps and extendible hashing have no home in CLRS 4th ed. The word "binomial" occurs in the book only in the combinatorial sense (the binomial distribution, binomial coefficients, the binomial theorem), never for the heap. The syllabus\'s "extendible hashing" is likewise absent: Chapter 11 covers chaining, open addressing and universal hashing, but not dynamic or extendible schemes.',
    ),
  },
  {
    module: 8,
    title: "Contemporary Issues",
    hours: 2,
    contentText: paragraphs(
      TEXT_BASIS,
      'Recorded, not drafted. The handbook gives this module a title and **2 hours** but lists **no topics** for it. The handbook does not say what "Contemporary Issues" is to contain, so nothing is drafted here and nothing is attributed to CLRS.',
      "This is deliberate. The seed records the module as it is stated rather than inventing a topic list, because an invented list would be indistinguishable from a handbook fact once it is in the database.",
    ),
  },
]

export const DSA_LAB_EXPERIMENTS: ExperimentMaterial[] = [
  {
    experiment: 1,
    title: "Analyzing the complexity of iterative and recursive algorithms",
    contentText:
      "Count the operations of an iterative algorithm and derive its asymptotic running time; do the same for a recursive algorithm by writing its recurrence and solving it with the substitution and recursion-tree methods. Prescribed text: Chapter 2 for the analysis of iterative algorithms and Chapter 4 for recurrences.",
  },
  {
    experiment: 2,
    title: "Implement Linear data structures (Stacks, Queues, Linked Lists)",
    contentText:
      "Implement a stack, a queue and singly and doubly linked lists over an array and over pointers, and compare the running times of the operations. Prescribed text: Chapter 10 (§10.1 array-based structures, §10.2 linked lists).",
  },
  {
    experiment: 3,
    title: "Linear time sorting techniques",
    contentText:
      "Implement counting sort, radix sort and bucket sort, and verify the linear-time behaviour against a comparison sort on suitable inputs. Prescribed text: Chapter 8 (§8.2, §8.3, §8.4), with the lower bound in §8.1 explaining why the comparison sorts cannot match them.",
  },
  {
    experiment: 4,
    title: "Interpolation search & Exponential search",
    contentText:
      'Not covered by the prescribed text. CLRS 4th ed. does not treat either search: its search material is linear search (Exercise 2.1-4), the binary-search-tree operations of Chapter 12, and the selection algorithms of Chapter 9. The phrase "exponential search" occurs in CLRS only as the *exponential search tree*, a different data structure (notes to §17.5, p. 478). This experiment is recorded as a syllabus item whose prescribed text does not cover it.',
  },
  {
    experiment: 5,
    title: "Binary tree & Tree traversals",
    contentText:
      "Build a binary tree and implement the pre-order, in-order and post-order traversals, then a level-order traversal using a queue. Prescribed text: §10.3 for rooted-tree representation and Appendix B.5 for binary-tree properties; §20.2–§20.3 for the breadth-first and depth-first traversal patterns.",
  },
  {
    experiment: 6,
    title: "B-trees & B+ trees",
    contentText:
      "Implement the search, split and insert operations of a B-tree, and observe the effect of the minimum degree on height. Prescribed text: Chapter 18 for B-trees. **B+-trees are not covered by the prescribed text** — the chapter treats B-trees only, and the B+-tree, with records held at the leaves and a linked leaf level, is not in CLRS 4th ed.",
  },
  {
    experiment: 7,
    title: "Advanced Trees: 2-3 tree, splay tree, red black tree etc.",
    contentText:
      "Implement the red-black tree insert and delete operations with rotations, and verify the black-height invariant. Prescribed text: Chapter 13 in full. **2-3 trees and splay trees are mentioned only in the notes of the prescribed text** (§17.5 notes, pp. 358–359 and 478) and have no section of their own there.",
  },
  {
    experiment: 8,
    title: "Advanced Trees: Threaded Binary trees, tournament trees",
    contentText:
      'Not covered by the prescribed text. Neither threaded binary trees nor tournament trees has a home in CLRS 4th ed.; the word "threaded" in the book refers to multithreaded computation in the bibliography, not to tree threading, and "tournament tree" does not appear. This experiment is recorded as a syllabus item whose prescribed text does not cover it.',
  },
  {
    experiment: 9,
    title: "Graph traversals (BFS, DFS, Topological sorting)",
    contentText:
      "Represent a directed graph with adjacency lists, run breadth-first and depth-first search, and produce a topological order of a DAG. Prescribed text: §20.1 representations, §20.2 breadth-first search, §20.3 depth-first search, §20.4 topological sort.",
  },
  {
    experiment: 10,
    title: "Determining the Shortest path between pair of nodes in the given graph",
    contentText:
      "Run Dijkstra's algorithm from a single source, and compute all-pairs shortest paths with the Floyd-Warshall algorithm; compare the running times. Prescribed text: §22.3 Dijkstra, §22.1 Bellman-Ford for negative edge weights, §23.2 Floyd-Warshall.",
  },
  {
    experiment: 11,
    title: "Minimum Spanning trees - reverse delete & Borůvka's algorithm",
    contentText:
      "Compute a minimum spanning tree with the greedy characterisation and compare with Kruskal's and Prim's algorithms. Prescribed text: Chapter 21 — §21.1 for the cut and cycle properties and §21.2 for Kruskal and Prim. **Borůvka's algorithm is described only in the chapter notes (p. 603)**, which point to the MST-REDUCE procedure of Problem 21-2, and the **reverse-delete algorithm is not covered by the prescribed text at all**.",
  },
  {
    experiment: 12,
    title: "Heaps & Hashing",
    contentText:
      "Build a binary heap, implement heapsort and a priority queue, then compare separate chaining with open addressing for collision resolution. Prescribed text: Chapter 6 for heaps and §6.5 for priority queues; Chapter 11 for hashing, including chaining (§11.2) and open addressing (§11.4). **Extendible hashing is not covered** by the prescribed text.",
  },
]

// ---------------------------------------------------------------------------
// MCSE502L — Design and Analysis of Algorithms (theory)
// ---------------------------------------------------------------------------

export const DAA_THEORY_MODULES: ModuleMaterial[] = [
  {
    module: 1,
    title: "Greedy, Divide and Conquer Techniques",
    hours: 6,
    contentText: paragraphs(
      TEXT_BASIS,
      "Module scope (handbook): overview and importance of algorithms; stages of algorithm development — describing the problem, identifying a suitable technique, design of an algorithm, illustration of design stages; greedy techniques — graph colouring problem and job sequencing problem with deadlines; divide and conquer — Karatsuba's fast multiplication method and the Strassen algorithm for matrix multiplication.",
      "Covered by the prescribed text. Divide-and-conquer is Chapter 4, and Strassen's algorithm for matrix multiplication is §4.2. Greedy algorithms are Chapter 15, whose worked examples are the activity-selection problem (§15.1) and Huffman codes (§15.3), with §15.2 stating the elements of the greedy strategy.",
      "Not covered by the prescribed text. Karatsuba's fast multiplication method is not developed: the name occurs in CLRS only in a bibliographic note beside Strassen's method, recording the history rather than presenting the algorithm. The handbook's two greedy examples have no home — **job sequencing with deadlines appears nowhere in CLRS 4th ed.**, and **graph colouring appears only as NP-completeness exercises** (Problem 34-3 and the appendix problem B-1), not as a greedy algorithm. Substitute in the prescribed text's own vocabulary: activity selection and Huffman coding for the greedy technique, and Strassen's method for divide-and-conquer multiplication.",
    ),
  },
  {
    module: 2,
    title: "Dynamic Programming, Backtracking and Branch & Bound Techniques",
    hours: 9,
    contentText: paragraphs(
      TEXT_BASIS,
      "Module scope (handbook): dynamic programming — matrix-chain multiplication and longest common subsequence; backtracking — N-Queens problem, subset sum, graph colouring; branch and bound — A-Star, LIFO-BB and FIFO-BB methods.",
      'Covered by the prescribed text. Dynamic programming is Chapter 14: matrix-chain multiplication is §14.2 and the longest common subsequence is §14.4, with §14.3 setting out the elements of dynamic programming. The 0-1 knapsack problem is discussed in §15.2, in the "Greedy versus dynamic programming" passage, as the case where the greedy choice fails; its dynamic-programming solution is left to an exercise rather than developed in the text.',
      "Not covered by the prescribed text. Backtracking is not a technique CLRS 4th ed. develops; the N-Queens problem and graph colouring as backtracking searches have no home, and the branch-and-bound family — A*, LIFO-BB and FIFO-BB — is absent entirely. Subset sum does appear, but only as an NP-complete problem (§34.5) and as the approximation algorithm of §35.5; it is never presented as a backtracking search. This module is therefore the largest genuine gap in the syllabus relative to the prescribed text.",
    ),
  },
  {
    module: 3,
    title: "Amortized analysis and String Matching Algorithms",
    hours: 6,
    contentText: paragraphs(
      TEXT_BASIS,
      "Module scope (handbook): stack operations and incrementing binary counter; the aggregate method, the accounting method and the potential method; dynamic tables; naive string-matching algorithm; KMP algorithm; Rabin-Karp algorithm; string matching with finite automata.",
      "Covered by the prescribed text, in full. Amortized analysis is Chapter 16: §16.1 aggregate analysis (whose worked examples include the stack operations and the incrementing binary counter), §16.2 the accounting method, §16.3 the potential method and §16.4 dynamic tables. String matching is Chapter 32: §32.1 the naive algorithm, §32.2 Rabin-Karp, §32.3 string matching with finite automata, §32.4 the Knuth-Morris-Pratt algorithm.",
      "No gaps. Every named topic in this module has a section in the prescribed text.",
    ),
  },
  {
    module: 4,
    title: "Network Flow Algorithms",
    hours: 6,
    contentText: paragraphs(
      TEXT_BASIS,
      "Module scope (handbook): flow networks; maximum flows — Ford-Fulkerson, Edmonds-Karp and the push-relabel algorithm; the relabel-to-front algorithm; minimum cost flows — the cycle-cancelling algorithm.",
      "Covered by the prescribed text. Flow networks are §24.1 and the Ford-Fulkerson method is §24.2, which derives the Edmonds-Karp bound from breadth-first augmentation and proves the max-flow min-cut theorem. Maximum bipartite matching is §24.3.",
      "Mentioned but not developed. The push-relabel algorithm is named only in the notes to Chapter 24 (p. 703), where the book records its history; it has no section, no pseudocode and no analysis in CLRS 4th ed.",
      'Not covered by the prescribed text. The relabel-to-front algorithm is absent. The minimum-cost-flow **problem** is formulated in §29.2, but CLRS says explicitly that, although a polynomial-time algorithm exists that is not based on linear programming, "we won\'t describe the algorithm" — so the cycle-cancelling method has no home in the prescribed text.',
    ),
  },
  {
    module: 5,
    title: "Computational Geometry",
    hours: 5,
    contentText: paragraphs(
      TEXT_BASIS,
      "Module scope (handbook): line segments — properties and intersection; convex hull finding algorithms — Graham's scan and Jarvis's march.",
      'Not covered by the prescribed text, and this is a structural gap rather than an omission. The computational-geometry chapter that the third edition carried was **removed from CLRS 4th ed.** The terms "convex hull", "Graham\'s scan" and "Jarvis\'s march" do not appear in the fourth edition\'s index or body, and neither does the phrase "computational geometry". Nothing is substituted here: drafting these algorithms from another source and filing them under the prescribed text would misrepresent what the prescribed text contains.',
    ),
  },
  {
    module: 6,
    title: "Linear Optimization and Randomized algorithms",
    hours: 5,
    contentText: paragraphs(
      TEXT_BASIS,
      "Module scope (handbook): linear programming problem; the simplex method and the Big-M method; LP duality; the hiring problem; finding the global minimum cut.",
      "Covered by the prescribed text. Linear programming is Chapter 29: §29.1 presents the simplex algorithm (p. 857) and the formulation of linear programs, and §29.3 is duality. The hiring problem is §5.1, and §5.3 introduces randomized algorithms and the distinction between algorithms that are randomized and analyses that assume random input.",
      'Present only as a problem. The global minimum cut has a home in the problems at the end of Chapter 24 (pp. 701–703), which develop the contraction algorithm and ask the reader to bound its probability of success and its running time; the phrase "global minimum cut" is used in the problem statement, though the technique is not taught in the chapter body.',
      "Not covered by the prescribed text. The **Big-M** method is absent — CLRS presents the simplex algorithm with slack variables and does not develop Big-M. The **Las Vegas / Monte Carlo** terminology is absent: the words do not occur anywhere in CLRS 4th ed., even though the text does treat randomized algorithms, so the syllabus's vocabulary for that material has no counterpart in the prescribed text.",
    ),
  },
  {
    module: 7,
    title: "NP Completeness and Approximation Algorithms",
    hours: 6,
    contentText: paragraphs(
      TEXT_BASIS,
      "Module scope (handbook): the class P; the class NP; reducibility and NP-completeness; the circuit satisfiability problem and SAT 3CNF; independent set and clique; approximation algorithms — vertex cover, set cover and the travelling salesman.",
      "Covered by the prescribed text, in full, under CLRS's own names for two of the problems. NP-completeness is Chapter 34: the class P is §34.1, polynomial-time verification and the class NP §34.2, reducibility and NP-completeness §34.3, NP-completeness proofs §34.4 and NP-complete problems §34.5. The handbook's \"circuit satisfiability problem\" is CLRS's **CIRCUIT-SAT** (proved NP-complete in §34.3), and its \"SAT 3CNF\" is CLRS's **3-CNF-SAT** (§34.4); the two names denote the same problems. Independent set and clique are among the NP-complete problems of §34.5. Approximation algorithms are Chapter 35: vertex cover §35.1, the travelling-salesperson problem §35.2 and the set-covering problem §35.3.",
      "No gaps. Every named topic in this module has a section in the prescribed text.",
    ),
  },
  {
    module: 8,
    title: "Contemporary Issues",
    hours: 2,
    contentText: paragraphs(
      TEXT_BASIS,
      "Recorded, not drafted. The handbook gives this module a title and **2 hours** but lists **no topics** for it. Nothing is drafted here and nothing is attributed to CLRS.",
      "This is deliberate: the seed records the module as the handbook states it rather than inventing a topic list that would look like a handbook fact once stored.",
    ),
  },
]

export const DAA_LAB_EXPERIMENTS: ExperimentMaterial[] = [
  {
    experiment: 1,
    title: "Greedy Strategy: Graph Coloring Problem, Job Sequencing Problem with Deadlines",
    contentText:
      "Not covered by the prescribed text. CLRS 4th ed.'s greedy examples are the activity-selection problem (§15.1) and Huffman codes (§15.3). **Graph colouring appears in CLRS only as NP-completeness exercises** (Problem 34-3 and appendix problem B-1), and **job sequencing with deadlines does not appear at all**. The experiment is recorded as a syllabus item the prescribed text does not cover; the nearest greedy material in CLRS's own vocabulary is activity selection.",
  },
  {
    experiment: 2,
    title: "Divide and Conquer: Karatsuba's method, Strassen's algorithm",
    contentText:
      "Implement Strassen's algorithm for matrix multiplication and compare its operation count with the naive method at growing sizes. Prescribed text: Chapter 4, §4.2 Strassen's algorithm. **Karatsuba's fast multiplication method is not developed in the prescribed text** — the name appears only in a bibliographic note beside Strassen's method, so no content is drafted for it here.",
  },
  {
    experiment: 3,
    title: "Dynamic Programming: Matrix Chain Multiplication, LCS, 0-1 Knapsack",
    contentText:
      "Implement matrix-chain multiplication and the longest common subsequence by dynamic programming, then the 0-1 knapsack. Prescribed text: §14.2 matrix-chain multiplication, §14.4 longest common subsequence; the 0-1 knapsack is discussed in §15.2 as the case where the greedy choice fails, and its dynamic-programming solution is left to an exercise rather than developed in the text.",
  },
  {
    experiment: 4,
    title: "Backtracking: N-queens, Subset sum",
    contentText:
      "Not covered by the prescribed text. CLRS 4th ed. does not develop backtracking, so the N-Queens search has no home; subset sum appears only as an NP-complete problem (§34.5) and as the approximation algorithm of §35.5, never as a backtracking search. Recorded as a syllabus item the prescribed text does not cover.",
  },
  {
    experiment: 5,
    title: "Branch and Bound: Job selection",
    contentText:
      "Not covered by the prescribed text. The branch-and-bound family — including the LIFO and FIFO variants and A* search — is absent from CLRS 4th ed. Recorded as a syllabus item the prescribed text does not cover.",
  },
  {
    experiment: 6,
    title: "String Matching Algorithms: Rabin Karp Algorithm, KMP Algorithm",
    contentText:
      "Implement the naive matcher, the Rabin-Karp algorithm and the Knuth-Morris-Pratt algorithm, and compare their behaviour on adversarial patterns. Prescribed text: §32.1, §32.2 and §32.4, with string matching with finite automata in §32.3.",
  },
  {
    experiment: 7,
    title: "Network Flows: Ford-Fulkerson and Edmond-Karp, Cycle cancelling algorithm",
    contentText:
      "Implement the Ford-Fulkerson method with breadth-first augmentation (Edmonds-Karp) and verify the max-flow min-cut theorem on small networks. Prescribed text: §24.1 flow networks, §24.2 Ford-Fulkerson and Edmonds-Karp. **The cycle-cancelling algorithm is not covered** by the prescribed text: the minimum-cost-flow problem is formulated in §29.2 but CLRS explicitly does not describe an algorithm for it. **Push-relabel is named only in the chapter notes (p. 703)** and is not developed.",
  },
  {
    experiment: 8,
    title: "Minimum Cost flows - Cycle Cancelling Algorithm",
    contentText:
      "Not covered by the prescribed text. CLRS 4th ed. formulates the minimum-cost-flow problem in §29.2 and states plainly that it will not describe the algorithm; the cycle-cancelling method therefore has no home. Recorded as a syllabus item the prescribed text does not cover.",
  },
  {
    experiment: 9,
    title: "Linear programming: Simplex method",
    contentText:
      "Formulate a small linear program and solve it by the simplex algorithm, tracking basic and non-basic variables through the pivots. Prescribed text: §29.1 (the simplex algorithm, p. 857) and §29.3 for duality. **The Big-M method is not covered** by the prescribed text.",
  },
  {
    experiment: 10,
    title: "Randomized Algorithms: Las Vegas and Monte carlo",
    contentText:
      'Not covered by the prescribed text under this vocabulary. CLRS 4th ed. does treat randomized algorithms (Chapters 5 and 7, and the randomized selection in §9.2), but the terms "Las Vegas" and "Monte Carlo" do not appear anywhere in the fourth edition, so the syllabus\'s classification has no counterpart in the prescribed text. Recorded as a syllabus item the prescribed text does not cover in those terms.',
  },
  {
    experiment: 11,
    title: "Polynomial time algorithm for verification of NPC problems",
    contentText:
      "Write polynomial-time verifiers for NP-complete problems — for example a certificate check for satisfiability or for the independent-set problem — and confirm that the certificate is checkable in polynomial time. Prescribed text: §34.2 polynomial-time verification, with §34.5 for the problems themselves.",
  },
  {
    experiment: 12,
    title: "Approximation Algorithm: Vertex cover, Set cover and TSP",
    contentText:
      "Implement the 2-approximation for vertex cover, the greedy set-covering heuristic, and a travelling-salesperson approximation, and compare each result with the optimum on small instances. Prescribed text: §35.1 vertex cover, §35.2 the travelling-salesperson problem, §35.3 the set-covering problem.",
  },
]

/** The subtopic vocabularies the courses declare, drawn from the module topics above. */
export const COURSE_SUBTOPIC_VOCABULARY = {
  dsaTheory: [
    "asymptotic notation",
    "recurrences",
    "arrays",
    "stacks and queues",
    "linked lists",
    "sorting",
    "searching",
    "order statistics",
    "binary search trees",
    "b-trees",
    "red-black trees",
    "graph traversal",
    "topological sort",
    "shortest paths",
    "minimum spanning trees",
    "heaps",
    "hashing",
  ],
  dsaLab: [
    "complexity analysis",
    "linear data structures",
    "linear-time sorting",
    "tree traversals",
    "b-trees",
    "balanced trees",
    "graph traversal",
    "shortest paths",
    "minimum spanning trees",
    "heaps and hashing",
  ],
  daaTheory: [
    "greedy algorithms",
    "divide and conquer",
    "dynamic programming",
    "backtracking",
    "branch and bound",
    "amortized analysis",
    "string matching",
    "network flow",
    "computational geometry",
    "linear programming",
    "randomized algorithms",
    "np-completeness",
    "approximation algorithms",
  ],
  daaLab: [
    "greedy algorithms",
    "divide and conquer",
    "dynamic programming",
    "backtracking",
    "branch and bound",
    "string matching",
    "network flow",
    "linear programming",
    "randomized algorithms",
    "np-completeness",
    "approximation algorithms",
  ],
} as const
