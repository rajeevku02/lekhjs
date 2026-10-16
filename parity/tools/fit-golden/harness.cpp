// AC-REC-02 oracle: runs the C++ akaar Quadrilateral and Triangle (and, for the recognizer's
// regularisation, the fitter::Quadrilateral twin) on a deterministic case set and prints the
// inputs and results as JSON. Built and run by regen.mjs (never by the product).
//
// Inputs are on a 1/64 grid, so they are exact in float and double alike.
#include <cstdio>
#include <cstdint>
#include <cmath>
#include <vector>
#include "akaar/Geometry.h"
#include "fitter/QuadFitter.h"
#include "base/Const.h"

using avabodh::akaar::Quadrilateral;
using avabodh::akaar::Triangle;
using avabodh::geometry::Point;

namespace {

uint64_t state = 0x9E3779B97F4A7C15ull;
double rnd() {  // xorshift64*, in [0, 1)
    state ^= state >> 12; state ^= state << 25; state ^= state >> 27;
    return (double)((state * 2685821657736338717ull) >> 11) / 9007199254740992.0;
}
double range(double a, double b) { return a + (b - a) * rnd(); }
double q64(double v) { return std::round(v * 64.0) / 64.0; }

struct P { double x, y; };

P rot(P p, P c, double a) {
    double dx = p.x - c.x, dy = p.y - c.y;
    return { c.x + dx * std::cos(a) - dy * std::sin(a), c.y + dx * std::sin(a) + dy * std::cos(a) };
}

void printPt(const Point& p) { std::printf("[%.17g,%.17g]", (double)p.x, (double)p.y); }
void printP(P p) { std::printf("[%.17g,%.17g]", p.x, p.y); }

std::vector<P> quadCase(int i) {
    double cx = range(-400, 800), cy = range(-400, 800);
    double w = range(20, 600), h = range(20, 600);
    double ang = 0, jit = 0;
    switch (i % 8) {
        case 0: jit = range(0, 3); break;                              // axis-aligned rectangle
        case 1: ang = range(-0.6, 0.6); jit = range(0, 4); break;      // rotated rectangle
        case 2: h = w + range(-1.5, 1.5); jit = range(0, 0.6); break;  // near square
        case 3: h = w + range(-1.5, 1.5); ang = range(-1.5, 1.5); jit = range(0, 0.6); break;
        case 4: jit = range(5, 60); ang = range(-3, 3); break;         // loose quad
        case 5: ang = 0.785398 + range(-0.3, 0.3); h = w + range(-8, 8); jit = range(0, 3); break;  // ~45°
        case 6: ang = range(-0.25, 0.25); jit = range(0, 2); break;    // parallelogram, below
        default: jit = range(0, 200); break;                           // anything
    }
    std::vector<P> v = { {cx - w/2, cy - h/2}, {cx - w/2, cy + h/2}, {cx + w/2, cy + h/2}, {cx + w/2, cy - h/2} };
    if (i % 8 == 6) { double s = range(-0.5, 0.5) * w; v[1].x += s; v[2].x += s; }
    P c = {cx, cy};
    for (auto& p : v) {
        p = rot(p, c, ang);
        p.x = q64(p.x + range(-jit, jit));
        p.y = q64(p.y + range(-jit, jit));
    }
    return v;
}

std::vector<P> triCase(int i) {
    double cx = range(-400, 800), cy = range(-400, 800), r = range(10, 400);
    double ang = range(-3.2, 3.2), jit;
    switch (i % 4) {
        case 0: jit = range(0, 0.3); break;
        case 1: jit = range(0, 1.5); break;
        case 2: jit = range(1, 20); break;
        default: jit = range(0, 150); break;
    }
    std::vector<P> v;
    for (int k = 0; k < 3; k++) {
        double a = ang + k * 2.0943951023931953;
        v.push_back({ q64(cx + r * std::cos(a) + range(-jit, jit)), q64(cy + r * std::sin(a) + range(-jit, jit)) });
    }
    return v;
}

}  // namespace

int main(int argc, char** argv) {
    int n = argc > 1 ? std::atoi(argv[1]) : 200;
    std::printf("{\"number_t_bytes\":%d,\"pi\":%.17g,\"quads\":[\n", (int)sizeof(number_t), (double)PI);
    for (int i = 0; i < n; i++) {
        auto v = quadCase(i);
        Point a(v[0].x, v[0].y), b(v[1].x, v[1].y), c(v[2].x, v[2].y), d(v[3].x, v[3].y);
        Quadrilateral q(a, b, c, d, 2);
        int isRect = q.isRectangle();
        bool isSq = q.isSquare();
        Quadrilateral sq(a, b, c, d, 2);
        sq.makeSquare();
        Quadrilateral pq(a, b, c, d, 2);
        pq.polish();
        avabodh::fitter::Quadrilateral fq(a, b, c, d);
        fq.regualarize();
        std::printf("%s{\"in\":[", i ? ",\n" : "");
        for (int k = 0; k < 4; k++) { if (k) std::printf(","); printP(v[k]); }
        std::printf("],\"isRectangle\":%s,\"isSquare\":%s,\"makeSquare\":[", isRect ? "true" : "false", isSq ? "true" : "false");
        printPt(sq.p1); std::printf(","); printPt(sq.p2); std::printf(","); printPt(sq.p3); std::printf(","); printPt(sq.p4);
        std::printf("],\"polish\":[");
        printPt(pq.p1); std::printf(","); printPt(pq.p2); std::printf(","); printPt(pq.p3); std::printf(","); printPt(pq.p4);
        std::printf("],\"polishAngle\":%.17g,\"regularize\":[", (double)pq.angle());
        printPt(fq.p1()); std::printf(","); printPt(fq.p2()); std::printf(","); printPt(fq.p3()); std::printf(","); printPt(fq.p4());
        std::printf("],\"regularizeAngle\":%.17g}", (double)fq.angle());
    }
    std::printf("\n],\"triangles\":[\n");
    for (int i = 0; i < n; i++) {
        auto v = triCase(i);
        Point a(v[0].x, v[0].y), b(v[1].x, v[1].y), c(v[2].x, v[2].y);
        Triangle t(a, b, c);
        bool eq = t.isEquilateral();
        Triangle m(a, b, c);
        m.makeEquilateral();
        std::printf("%s{\"in\":[", i ? ",\n" : "");
        for (int k = 0; k < 3; k++) { if (k) std::printf(","); printP(v[k]); }
        std::printf("],\"isEquilateral\":%s,\"makeEquilateral\":[", eq ? "true" : "false");
        printPt(m.p1); std::printf(","); printPt(m.p2); std::printf(","); printPt(m.p3);
        std::printf("]}");
    }
    std::printf("\n]}\n");
    return 0;
}
