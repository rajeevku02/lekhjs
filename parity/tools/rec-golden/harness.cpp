// AC-REC-13 oracle: runs the C++ regularizer (through Regularizer::regularize) and the live fitters
// (CurveFitObject Initialise + FitSingle, EllipseFitter::fit, fitter::Quadrilateral::
// isNonRotatedRectangle) on a deterministic case set and prints inputs and results as JSON.
// Built and run by regen.mjs (never by the product).
//
//   harness rec   -> regularizer cases
//   harness fit   -> fitter cases
//
// Inputs are on a 1/64 grid, so they are exact in float and double alike. regen.mjs patches the
// scratch copy of PolyRegularizer.cpp to store the chosen feature index in g_regFid (no logic
// change); the harness replays the Regularizer dispatch with it to record which branch ran, and
// checks that the replay produced exactly what Regularizer::regularize produced.
#include <cstdio>
#include <cstdint>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include "base/Const.h"
#include "geometry/SimplePath.h"
#include "geometry/Ellipse.h"
#include "regularizer/Regularizer.h"
#include "regularizer/OneLineRegularizer.h"
#include "regularizer/TwoLineRegularizer.h"
#include "regularizer/ThreeLineRegularizer.h"
#include "regularizer/FourLineRegularizer.h"
#include "regularizer/FiveLineRegularizer.h"
#include "regularizer/SixLineRegularizer.h"
#include "regularizer/EightLineRegularizer.h"
#include "regularizer/CurveRegularizer.h"
#include "regularizer/PolyLineRegularizer.h"
#include "fitter/CurveFitter.h"
#include "fitter/EllipseFitter.h"
#include "fitter/QuadFitter.h"

int g_regFid = -99;

using namespace avabodh::geometry;
using namespace avabodh::regularizer;

namespace {

uint64_t state = 0x2545F4914F6CDD1Dull;
double rnd() {  // xorshift64*, in [0, 1)
    state ^= state >> 12; state ^= state << 25; state ^= state >> 27;
    return (double)((state * 2685821657736338717ull) >> 11) / 9007199254740992.0;
}
double range(double a, double b) { return a + (b - a) * rnd(); }
int irange(int a, int b) { return a + (int)(rnd() * (b - a + 1)) % (b - a + 1); }
double q64(double v) { return std::round(v * 64.0) / 64.0; }

struct P { double x, y; };
P rot(P p, P c, double a) {
    double dx = p.x - c.x, dy = p.y - c.y;
    return { c.x + dx * std::cos(a) - dy * std::sin(a), c.y + dx * std::sin(a) + dy * std::cos(a) };
}
P jq(P p, double jit) { return { q64(p.x + range(-jit, jit)), q64(p.y + range(-jit, jit)) }; }

std::string num(double v) { char b[40]; std::snprintf(b, sizeof b, "%.17g", v); return b; }
std::string pt(const Point& p) { return "[" + num(p.x) + "," + num(p.y) + "]"; }

struct Case {
    std::string group, label;
    SimplePath path;
    std::vector<Point> cpts;
    bool convex = true;
};

std::string comps(const SimplePath& p) {
    std::string s = "[";
    for (size_t i = 0; i < p.size(); i++) {
        const PathComponent& c = p[i];
        if (i) s += ",";
        if (c.isCurve) {
            s += "[" + num(c.curve.point1.x) + "," + num(c.curve.point1.y) + "," + num(c.curve.point2.x) + "," +
                 num(c.curve.point2.y) + "," + num(c.curve.point3.x) + "," + num(c.curve.point3.y) + "," +
                 num(c.curve.point4.x) + "," + num(c.curve.point4.y) + "]";
        } else {
            s += "[" + num(c.segment.point1().x) + "," + num(c.segment.point1().y) + "," + num(c.segment.point2().x) +
                 "," + num(c.segment.point2().y) + "]";
        }
    }
    return s + "]";
}

// Box mapping of unit-square template vertices, rotation about the centre, jitter, 1/64 grid.
struct Box { double x, y, w, h, ang, jit; };
std::vector<P> place(const std::vector<P>& unit, const Box& b) {
    P c = { b.x + b.w / 2, b.y + b.h / 2 };
    std::vector<P> out;
    for (auto u : unit) out.push_back(jq(rot({ b.x + u.x * b.w, b.y + u.y * b.h }, c, b.ang), b.jit));
    return out;
}
Box randBox(double minS, double maxS, double angMax, double jitFrac) {
    Box b;
    b.x = range(-300, 900); b.y = range(-300, 900);
    b.w = range(minS, maxS); b.h = range(minS, maxS);
    b.ang = angMax > 0 ? range(-angMax, angMax) : 0;
    b.jit = range(0, jitFrac) * std::min(b.w, b.h);
    return b;
}

// Segments v0->v1->...; closed adds the closing segment. `gap` moves each segment end on its own.
Case poly(const std::string& group, const std::string& label, const std::vector<P>& v, bool closed, bool convex,
          double gap = 0) {
    Case c;
    c.group = group; c.label = label; c.convex = convex;
    size_t n = v.size();
    size_t segs = closed ? n : n - 1;
    for (size_t i = 0; i < segs; i++) {
        P a = v[i], b = v[(i + 1) % n];
        if (gap > 0) { a = jq(a, gap); b = jq(b, gap); }
        c.path.add(Point(a.x, a.y), Point(b.x, b.y));
    }
    c.path.setClosed(closed);
    static int k = 0;
    if (++k % 7 != 0) for (auto p : v) c.cpts.push_back(Point(p.x, p.y));
    return c;
}

std::vector<P> regular(int n, double phase) {
    std::vector<P> v;
    for (int k = 0; k < n; k++) {
        double a = phase + k * 2 * 3.14159265358979323846 / n;
        v.push_back({ 0.5 + 0.5 * std::cos(a), 0.5 + 0.5 * std::sin(a) });
    }
    return v;
}
std::vector<P> randomConvex(int n) {
    std::vector<double> a;
    for (int k = 0; k < n; k++) a.push_back(range(0, 6.283185307179586));
    std::sort(a.begin(), a.end());
    std::vector<P> v;
    for (double t : a) v.push_back({ 0.5 + 0.5 * std::cos(t), 0.5 + 0.5 * std::sin(t) });
    return v;
}

// Unit templates: the C++ features (0..1 box coordinates, p1=(0,0) p2=(0,1) p3=(1,1) p4=(1,0)).
const std::vector<std::vector<P>> T2 = { {{0,1},{1,1},{1,0}}, {{1,1},{1,0},{0,0}}, {{1,0},{0,0},{0,1}}, {{0,0},{0,1},{1,1}} };
const std::vector<std::vector<P>> T3c = {
    {{0,0},{0,1},{1,1}}, {{0,1},{1,1},{1,0}}, {{1,1},{1,0},{0,0}}, {{1,0},{0,0},{0,1}},
    {{0,0.5},{1,1},{1,0}}, {{0.5,1},{1,0},{0,0}}, {{1,0.5},{0,0},{0,1}}, {{0.5,0},{0,1},{1,1}} };
const std::vector<std::vector<P>> T3o = {
    {{0,0},{0,1},{1,1},{1,0}}, {{0,1},{1,1},{1,0},{0,0}}, {{1,1},{1,0},{0,0},{0,1}}, {{1,0},{0,0},{0,1},{1,1}} };
const std::vector<std::vector<P>> T4 = {
    {{0,0},{0,1},{1,1},{1,0}}, {{0.5,0},{0,0.5},{0.5,1},{1,0.5}},
    {{1.7/8,0},{0,1},{6.3/8,1},{1,0}}, {{0,0},{1.7/8,1},{1,1},{6.3/8,0}},
    {{0,0},{0.3,1},{0.7,1},{1,0}}, {{0.3,0},{0,1},{1,1},{0.7,0}},
    {{0,0.5},{0,1},{1,1},{1,0}}, {{0,0},{0,1},{1,1},{1,0.5}} };
const std::vector<std::vector<P>> T5 = {
    {{0.5,0},{0,3.0/8},{1.5/8,1},{6.5/8,1},{1,3.0/8}},
    {{0,0.5},{3.0/8,1},{1,6.5/8},{1,1.5/8},{3.0/8,0}},
    {{0.5,1},{1,5.0/8},{6.5/8,0},{1.5/8,0},{0,5.0/8}},
    {{1,0.5},{5.0/8,0},{0,1.5/8},{0,6.5/8},{5.0/8,1}} };
const std::vector<std::vector<P>> T6 = {
    {{0.5,0},{0,2.0/8},{0,6.0/8},{0.5,1},{1,6.0/8},{1,2.0/8}},
    {{0,0.5},{2.0/8,1},{6.0/8,1},{1,0.5},{6.0/8,0},{2.0/8,0}} };
const std::vector<P> T8 = { {2.0/8,0},{0,2.0/8},{0,6.0/8},{2.0/8,1},{6.0/8,1},{1,6.0/8},{1,2.0/8},{6.0/8,0} };

std::vector<P> rotateStart(std::vector<P> v, int k) { std::rotate(v.begin(), v.begin() + (k % v.size()), v.end()); return v; }
std::vector<P> reversed(std::vector<P> v) { std::reverse(v.begin(), v.end()); return v; }

// A template-based figure: random start vertex and direction, so the matching sees any order.
std::vector<P> shuffleOrder(std::vector<P> v, bool closed) {
    if (closed) v = rotateStart(v, irange(0, (int)v.size() - 1));
    if (rnd() < 0.5) v = reversed(v);
    return v;
}

std::vector<Case> recCases() {
    std::vector<Case> cs;
    char lb[64];
    // one line
    for (int i = 0; i < 60; i++) {
        double len = range(5, 600), a;
        switch (i % 6) {
            case 0: a = range(-0.21, 0.21); break;                                 // near horizontal
            case 1: a = 1.5707963267948966 + range(-0.21, 0.21); break;            // near vertical
            case 2: a = (rnd() < 0.5 ? 1 : -1) * range(0.148, 0.166); break;       // around 9 degrees
            case 3: a = range(-3.2, 3.2); break;                                   // any
            case 4: a = 3.141592653589793 + range(-0.2, 0.2); break;               // leftward
            default: a = -1.5707963267948966 + range(-0.17, 0.17); len = range(0.2, 40); break;
        }
        P s = { range(-300, 900), range(-300, 900) };
        P e = { s.x + len * std::cos(a), s.y + len * std::sin(a) };
        std::snprintf(lb, sizeof lb, "one-%d", i);
        cs.push_back(poly("one", lb, { jq(s, 0), jq(e, 0) }, false, true));
    }
    // two lines, open: the four L's, V's, arbitrary
    for (int i = 0; i < 64; i++) {
        std::vector<P> u;
        double jitFrac = 0.05, ang = 0.05;
        if (i % 5 == 4) { u = { {0, range(0,1)}, {range(0,1), 1}, {1, range(0,1)} }; jitFrac = 0.1; ang = 0.5; }
        else { u = T2[i % 4]; if (i % 8 >= 4) { jitFrac = 0.18; ang = 0.25; } }
        if (rnd() < 0.5) u = reversed(u);
        Box b = randBox(i % 5 == 0 ? 3 : 15, 400, ang, jitFrac);
        std::snprintf(lb, sizeof lb, "two-open-%d", i);
        cs.push_back(poly("two", lb, place(u, b), false, true));
    }
    // two lines, closed (a degenerate there-and-back: TwoLine makes a triangle, ThreeLine follows)
    for (int i = 0; i < 18; i++) {
        Box b = randBox(15, 300, 0.1, 0.05);
        std::snprintf(lb, sizeof lb, "two-closed-%d", i);
        const std::vector<P>& u = T2[i % 4];
        std::vector<P> v = i % 2 ? std::vector<P>{ u[0], u[2] } : std::vector<P>{ u[0], { u[1].x * 0.9 + u[2].x * 0.1, u[1].y * 0.9 + u[2].y * 0.1 } };
        if (i % 3 == 0) {  // a flat there-and-back: accepted, and the triangle goes on to ThreeLine
            b.ang = 0; b.jit = 0; b.h = range(0.2, 3);
            v = i % 2 ? std::vector<P>{ {0, 0}, {1, 1} } : std::vector<P>{ {1, 0}, {0, 1} };
        }
        cs.push_back(poly("two", lb, place(v, b), true, true));
    }
    // three lines, closed triangles
    for (int i = 0; i < 64; i++) {
        std::vector<P> u;
        double jitFrac = range(0, 0.08), ang = 0.08;
        if (i % 9 == 8) { u = randomConvex(3); jitFrac = 0.02; ang = 0; }
        else u = T3c[i % 8];
        if (i % 5 == 4) ang = 0.6;
        Box b = randBox(10, 500, ang, jitFrac);
        std::snprintf(lb, sizeof lb, "three-closed-%d", i);
        cs.push_back(poly("three", lb, place(shuffleOrder(u, true), b), true, true, i % 11 == 0 ? 1.5 : 0));
    }
    // three lines, open U's (even and uneven arms, Z's)
    for (int i = 0; i < 56; i++) {
        std::vector<P> u = T3o[i % 4];
        double jitFrac = range(0, 0.06), ang = 0.06;
        if (i % 7 == 1) { u[0] = { u[0].x * 0.3 + u[1].x * 0.7, u[0].y * 0.3 + u[1].y * 0.7 }; }  // short first arm
        if (i % 7 == 2) { u[3] = { u[3].x * 0.5 + u[2].x * 0.5, u[3].y * 0.5 + u[2].y * 0.5 }; }  // half last arm
        if (i % 7 == 3) { std::swap(u[2], u[3]); }                                                  // Z-ish
        if (i % 7 == 4) { jitFrac = 0.2; ang = 0.4; }
        if (rnd() < 0.5) u = reversed(u);
        Box b = randBox(8, 400, ang, jitFrac);
        std::snprintf(lb, sizeof lb, "three-open-%d", i);
        cs.push_back(poly("three", lb, place(u, b), false, true));
    }
    // four lines, closed: every feature, small and big (> 200: the area-ratio rule), thin houses,
    // rotated rectangles, parallelograms, random quads
    for (int i = 0; i < 96; i++) {
        std::vector<P> u;
        int kind = i % 12;
        if (kind < 8) u = T4[kind];
        else if (kind == 8) { double s = range(0.1, 0.35); u = { {s,0},{0,1},{1-s,1},{1,0} }; }   // parallelogram
        else if (kind == 9) u = randomConvex(4);
        else if (kind == 10) u = T4[0];
        else u = T4[1];
        double minS = (i / 12) % 2 ? 210 : 20, maxS = (i / 12) % 2 ? 700 : 200;
        double ang = kind == 10 ? range(0.05, 0.6) : 0.04;
        Box b = randBox(minS, maxS, ang, range(0, 0.05));
        if ((kind == 6 || kind == 7) && (i / 12) % 3 == 2) b.h = b.w / range(3.0, 6.0);  // thin house
        std::snprintf(lb, sizeof lb, "four-closed-%d", i);
        cs.push_back(poly("four", lb, place(shuffleOrder(u, true), b), true, true, i % 13 == 0 ? 1.0 : 0));
    }
    // four lines, open: no features, PolyLine fallback
    for (int i = 0; i < 24; i++) {
        std::vector<P> u = { {0,0},{range(0,0.2),1},{range(0.4,0.6),range(0.8,1)},{1,range(0.8,1)},{1,range(0,0.2)} };
        Box b = randBox(10, 400, 0.3, 0.05);
        std::snprintf(lb, sizeof lb, "four-open-%d", i);
        cs.push_back(poly("four", lb, place(u, b), false, true));
    }
    // five lines, closed
    for (int i = 0; i < 60; i++) {
        std::vector<P> u;
        double jitFrac = range(0, 0.06), ang = 0.05;
        int kind = i % 6;
        if (kind < 4) u = T5[kind];
        else if (kind == 4) u = regular(5, -1.5707963267948966 + range(-0.5, 0.5));
        else { u = randomConvex(5); jitFrac = 0.01; }
        if (i % 7 == 6) jitFrac = 0.15;
        Box b = randBox(20, 500, ang, jitFrac);
        std::snprintf(lb, sizeof lb, "five-closed-%d", i);
        cs.push_back(poly("five", lb, place(shuffleOrder(u, true), b), true, true));
    }
    for (int i = 0; i < 12; i++) {
        std::vector<P> u = regular(6, range(0, 6.28));
        Box b = randBox(20, 400, 0, 0.03);
        std::snprintf(lb, sizeof lb, "five-open-%d", i);
        cs.push_back(poly("five", lb, place(u, b), false, true));
    }
    // six lines, closed
    for (int i = 0; i < 56; i++) {
        std::vector<P> u;
        double jitFrac = range(0, 0.05);
        int kind = i % 5;
        if (kind < 2) u = T6[kind];
        else if (kind == 2) u = regular(6, range(-0.3, 0.3));
        else if (kind == 3) u = regular(6, 1.5707963267948966 + range(-0.3, 0.3));
        else { u = randomConvex(6); jitFrac = 0.01; }
        if (i % 6 == 5) jitFrac = 0.14;
        Box b = randBox(20, 500, 0.05, jitFrac);
        std::snprintf(lb, sizeof lb, "six-closed-%d", i);
        cs.push_back(poly("six", lb, place(shuffleOrder(u, true), b), true, true, i % 9 == 0 ? 1.0 : 0));
    }
    for (int i = 0; i < 10; i++) {
        std::vector<P> u = regular(7, range(0, 6.28));
        Box b = randBox(20, 400, 0, 0.03);
        std::snprintf(lb, sizeof lb, "six-open-%d", i);
        cs.push_back(poly("six", lb, place(u, b), false, true));
    }
    // eight lines, closed
    for (int i = 0; i < 56; i++) {
        std::vector<P> u;
        double jitFrac = range(0, 0.05);
        int kind = i % 4;
        if (kind < 2) u = T8;
        else if (kind == 2) u = regular(8, 3.141592653589793 / 8 + range(-0.2, 0.2));
        else { u = randomConvex(8); jitFrac = 0.01; }
        if (i % 5 == 4) jitFrac = 0.12;
        Box b = randBox(20, 500, 0.05, jitFrac);
        std::snprintf(lb, sizeof lb, "eight-closed-%d", i);
        cs.push_back(poly("eight", lb, place(shuffleOrder(u, true), b), true, true));
    }
    for (int i = 0; i < 10; i++) {
        std::vector<P> u = regular(9, range(0, 6.28));
        Box b = randBox(20, 400, 0, 0.03);
        std::snprintf(lb, sizeof lb, "eight-open-%d", i);
        cs.push_back(poly("eight", lb, place(u, b), false, true));
    }
    // non-convex: PolyLine on stars, orthogonal walks, L-polygons, near-axis zigzags, tiny segments
    for (int i = 0; i < 90; i++) {
        std::vector<P> v;
        bool closed = false;
        int kind = i % 6;
        if (kind == 0) {  // star
            int n = irange(4, 7);
            double r1 = range(40, 300), r2 = r1 * range(0.3, 0.6), ph = range(0, 6.28);
            P c = { range(-200, 800), range(-200, 800) };
            for (int k = 0; k < 2 * n; k++) {
                double a = ph + k * 3.141592653589793 / n, r = k % 2 ? r2 : r1;
                v.push_back(jq({ c.x + r * std::cos(a), c.y + r * std::sin(a) }, range(0, 3)));
            }
            closed = true;
        } else if (kind == 1 || kind == 2) {  // orthogonal-ish walk
            int n = irange(2, 12);
            P p = { range(-200, 800), range(-200, 800) };
            v.push_back(jq(p, 0));
            for (int k = 0; k < n; k++) {
                double len = range(-200, 200), off = range(-0.35, 0.35) * len;
                if (k % 2) p = { p.x + off, p.y + len }; else p = { p.x + len, p.y + off };
                v.push_back(jq(p, 0));
            }
            closed = kind == 2 && rnd() < 0.5;
        } else if (kind == 3) {  // L polygon
            Box b = randBox(30, 400, 0.15, 0.03);
            double s = range(0.2, 0.8), t = range(0.2, 0.8);
            v = place({ {0,0},{0,1},{1,1},{1,t},{s,t},{s,0} }, b);
            closed = true;
        } else if (kind == 4) {  // exact axis segments and degenerate bits
            P p = { q64(range(-200, 800)), q64(range(-200, 800)) };
            v.push_back(p);
            int n = irange(2, 8);
            for (int k = 0; k < n; k++) {
                int m = irange(0, 4);
                if (m == 0) p = { p.x, q64(p.y + range(-150, 150)) };
                else if (m == 1) p = { q64(p.x + range(-150, 150)), p.y };
                else if (m == 2) p = { q64(p.x + range(-0.7, 0.7)), q64(p.y + range(-0.7, 0.7)) };
                else p = { q64(p.x + range(-150, 150)), q64(p.y + range(-150, 150)) };
                v.push_back(p);
            }
            closed = rnd() < 0.3;
        } else {  // a rectangle or polygon flagged non-convex
            Box b = randBox(20, 400, 0.3, 0.05);
            v = place(i % 12 == 5 ? T4[0] : regular(irange(3, 9), range(0, 6.28)), b);
            closed = rnd() < 0.7;
        }
        std::snprintf(lb, sizeof lb, "poly-%d", i);
        cs.push_back(poly("polyline", lb, v, closed, false, i % 10 == 7 ? 1.0 : 0));
    }
    // no-ops: 7, 9, 10 lines; curves; empty
    for (int i = 0; i < 24; i++) {
        Case c;
        int kind = i % 6;
        char l2[64];
        if (kind <= 2) {
            int n = kind == 0 ? 7 : kind == 1 ? 9 : 10;
            Box b = randBox(30, 400, 0, 0.03);
            c = poly("noop", "", place(regular(n, range(0, 6.28)), b), true, true);
        } else if (kind == 5 && i < 12) {
            c.group = "noop"; c.convex = i == 5;
        } else {
            Box b = randBox(30, 400, 0, 0.03);
            c = poly("noop", "", place(T4[0], b), false, kind != 3);
            int nc = kind == 4 ? 2 : 1;
            for (int k = 0; k < nc; k++) {
                PathComponent& pc = c.path[k];
                Point a = pc.segment.point1(), d = pc.segment.point2();
                pc.isCurve = true;
                pc.curve = BezierCurve(a, Point(q64(a.x + range(-40, 40)), q64(a.y + range(-40, 40))),
                                       Point(q64(d.x + range(-40, 40)), q64(d.y + range(-40, 40))), d);
            }
        }
        std::snprintf(l2, sizeof l2, "noop-%d", i);
        c.label = l2;
        cs.push_back(c);
    }
    return cs;
}

std::string traceOf(SimplePath* path, const std::vector<Point>& cpts, bool convex) {
    // Replays Regularizer::regularize (Regularizer.cpp:23-68) to name the branches taken.
    std::string t = "[";
    auto add = [&](const std::string& s) { if (t.size() > 1) t += ","; t += "\"" + s + "\""; };
    auto poly = [&](PolyRegularizer& r, const char* name) {
        g_regFid = -99;
        r.regularize(path, cpts);
        add(std::string(name) + ":" + std::to_string(g_regFid));
    };
    int curveCount = path->curveCount();
    if (!convex) {
        if (curveCount == 0 && path->size() > 0) { PolyLineRegularizer r; r.regularize(path); add("polyline"); }
        return t + "]";
    }
    if (curveCount == 0) {
        if (path->size() == 1) { OneLineRegularizer r; r.regularize(path, cpts); add("one"); }
        if (path->size() == 2) { TwoLineRegularizer r; poly(r, "two"); }
        if (path->size() == 3) { ThreeLineRegularizer r; poly(r, "three"); }
        if (path->size() == 4) { FourLineRegularizer r; poly(r, "four"); }
        if (path->size() == 5) { FiveLineRegularizer r; poly(r, "five"); }
        if (path->size() == 6) { SixLineRegularizer r; poly(r, "six"); }
        if (path->size() == 8) { EightLineRegualizer r; poly(r, "eight"); }
    } else if (curveCount == 1) {
        CurveRegularizer r; r.regularize(path); add("curve");
    }
    return t + "]";
}

void runRec() {
    auto cs = recCases();
    std::printf("{\"number_t_bytes\":%d,\"pi\":%.17g,\"cases\":[\n", (int)sizeof(number_t), (double)PI);
    for (size_t i = 0; i < cs.size(); i++) {
        Case& c = cs[i];
        SimplePath real = c.path, replay = c.path;
        Regularizer reg;
        reg.regularize(&real, c.cpts, c.convex);
        std::string trace = traceOf(&replay, c.cpts, c.convex);
        if (comps(real) != comps(replay) || real.closed() != replay.closed()) {
            std::fprintf(stderr, "replay mismatch on %s\n", c.label.c_str());
            std::exit(2);
        }
        std::string cp = "[";
        for (size_t k = 0; k < c.cpts.size(); k++) cp += (k ? "," : "") + pt(c.cpts[k]);
        cp += "]";
        std::printf("%s{\"id\":\"%s\",\"group\":\"%s\",\"convex\":%s,\"closed\":%s,\"in\":%s,\"cpts\":%s,"
                    "\"out\":%s,\"outClosed\":%s,\"trace\":%s}",
                    i ? ",\n" : "", c.label.c_str(), c.group.c_str(), c.convex ? "true" : "false",
                    c.path.closed() ? "true" : "false", comps(c.path).c_str(), cp.c_str(), comps(real).c_str(),
                    real.closed() ? "true" : "false", trace.c_str());
    }
    std::printf("\n]}\n");
}

// ---- fitters ----

std::vector<P> curveRun(int i, int n) {
    std::vector<P> v;
    int kind = i % 5;
    P a = { range(-300, 900), range(-300, 900) };
    double s = range(20, 500);
    P b = { a.x + range(-s, s), a.y + range(-s, s) }, c = { a.x + range(-s, s), a.y + range(-s, s) },
      d = { a.x + range(-s, s), a.y + range(-s, s) };
    double jit = kind == 3 ? range(1, 8) : range(0, 1.5);
    double r = s / 2, a0 = range(0, 6.28), sweep = range(0.5, 4.5);
    for (int k = 0; k < n; k++) {
        double t = n > 1 ? (double)k / (n - 1) : 0;
        P p;
        if (kind == 0 || kind == 3) {  // a cubic
            double u = 1 - t;
            p = { u*u*u*a.x + 3*u*u*t*b.x + 3*u*t*t*c.x + t*t*t*d.x, u*u*u*a.y + 3*u*u*t*b.y + 3*u*t*t*c.y + t*t*t*d.y };
        } else if (kind == 1) {  // a circular arc
            p = { a.x + r * std::cos(a0 + sweep * t), a.y + r * std::sin(a0 + sweep * t) };
        } else if (kind == 2) {  // a straight line
            p = { a.x + (d.x - a.x) * t, a.y + (d.y - a.y) * t };
        } else {  // a zigzag
            p = { a.x + (d.x - a.x) * t + (k % 2 ? 6 : -6), a.y + (d.y - a.y) * t };
        }
        v.push_back(jq(p, jit));
    }
    return v;
}

std::vector<P> ellipseRun(int i) {
    int n = irange(12, 160);
    P c = { range(-300, 900), range(-300, 900) };
    double w = range(10, 500), asp = i % 4 == 0 ? range(1, 1.5) : range(1, 4.5), h = w / asp;
    double rotA;
    switch (i % 5) {
        case 0: rotA = range(-0.3, 0.3); break;
        case 1: rotA = 1.5707963267948966 + range(-0.5, 0.5); break;
        case 2: rotA = range(-3.2, 3.2); break;
        case 3: rotA = 3.141592653589793 + range(-0.45, 0.45); break;
        default: rotA = 0.7853981633974483 + range(-0.2, 0.2); break;
    }
    double sweep = i % 7 == 6 ? range(3, 6) : 6.283185307179586, ph = range(0, 6.28), jit = range(0, 0.04) * h;
    std::vector<P> v;
    for (int k = 0; k < n; k++) {
        double t = ph + sweep * k / n;
        v.push_back(jq(rot({ c.x + w / 2 * std::cos(t), c.y + h / 2 * std::sin(t) }, c, rotA), jit));
    }
    return v;
}

std::vector<P> quadRun(int i) {
    double cx = range(-400, 800), cy = range(-400, 800), w = range(20, 600), h = range(20, 600), ang = 0, jit;
    switch (i % 5) {
        case 0: jit = range(0, 3); break;
        case 1: ang = range(-0.12, 0.12); jit = range(0, 3); break;
        case 2: ang = range(-0.6, 0.6); jit = range(0, 4); break;
        case 3: ang = 0.785398 + range(-0.3, 0.3); jit = range(0, 3); break;
        default: ang = range(-3, 3); jit = range(5, 60); break;
    }
    std::vector<P> v = { {cx - w/2, cy - h/2}, {cx - w/2, cy + h/2}, {cx + w/2, cy + h/2}, {cx + w/2, cy - h/2} };
    for (auto& p : v) p = jq(rot(p, { cx, cy }, ang), jit);
    return v;
}

std::string pts(const std::vector<P>& v) {
    std::string s = "[";
    for (size_t k = 0; k < v.size(); k++) s += (k ? ",[" : "[") + num(v[k].x) + "," + num(v[k].y) + "]";
    return s + "]";
}
std::vector<Point> toPoints(const std::vector<P>& v) {
    std::vector<Point> out;
    for (auto p : v) out.push_back(Point(p.x, p.y));
    return out;
}

void runFit(int n) {
    std::printf("{\"number_t_bytes\":%d,\"pi\":%.17g,\"curves\":[\n", (int)sizeof(number_t), (double)PI);
    for (int i = 0; i < n; i++) {
        int count = i % 25 == 24 ? irange(0, 1) : i % 10 == 9 ? irange(2, 9) : irange(8, 200);
        auto v = curveRun(i, count);
        std::vector<Point> in = toPoints(v), out;
        avabodh::fitter::Path inPath(&in), outPath(&out);
        avabodh::fitter::CurveFitObject fit(&outPath, 70);
        bool ok = fit.Initialise(&inPath, in.size());
        if (ok) fit.FitSingle();
        std::string cv = "[";
        for (size_t k = 0; k < outPath.bzCurves.size(); k++) {
            const BezierCurve& b = outPath.bzCurves[k];
            cv += (k ? "," : "") + std::string("[") + pt(b.point1) + "," + pt(b.point2) + "," + pt(b.point3) + "," +
                  pt(b.point4) + "]";
        }
        cv += "]";
        std::printf("%s{\"in\":%s,\"init\":%s,\"curves\":%s}", i ? ",\n" : "", pts(v).c_str(), ok ? "true" : "false",
                    cv.c_str());
    }
    std::printf("\n],\"ellipses\":[\n");
    for (int i = 0; i < n; i++) {
        auto v = ellipseRun(i);
        std::vector<Point> in = toPoints(v);
        avabodh::fitter::EllipseFitter ef(&in);
        Ellipse e = ef.fit();
        std::printf("%s{\"in\":%s,\"center\":%s,\"width\":%s,\"height\":%s,\"rotation\":%s}", i ? ",\n" : "",
                    pts(v).c_str(), pt(e.center).c_str(), num(e.width).c_str(), num(e.height).c_str(),
                    num(e.rotation).c_str());
    }
    std::printf("\n],\"quads\":[\n");
    for (int i = 0; i < n; i++) {
        auto v = quadRun(i);
        avabodh::fitter::Quadrilateral q(Point(v[0].x, v[0].y), Point(v[1].x, v[1].y), Point(v[2].x, v[2].y),
                                         Point(v[3].x, v[3].y));
        std::printf("%s{\"in\":%s,\"isNonRotatedRectangle\":%s}", i ? ",\n" : "", pts(v).c_str(),
                    q.isNonRotatedRectangle() ? "true" : "false");
    }
    std::printf("\n]}\n");
}

}  // namespace

int main(int argc, char** argv) {
    const char* mode = argc > 1 ? argv[1] : "rec";
    if (std::strcmp(mode, "rec") == 0) runRec();
    else runFit(argc > 2 ? std::atoi(argv[2]) : 200);
    return 0;
}
