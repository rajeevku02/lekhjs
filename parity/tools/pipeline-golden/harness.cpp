// Capture harness for the recognizer pipeline golden (spec 07 §7.3, task R2). Built and run by
// regen.mjs; prints JSON on stdout.
//
// Each case is a synthetic line set (LineSetGenerators.h, plus the open and closed figures below)
// put straight into a C++ `Recognizer` through the LEKH_SEMANTIC_TEST_HOOKS seam (`testSetLines`,
// bypassing the stub LineAggregator, whose static getCost/isSingleLine the TS stub mirrors), and
// taken through `Recognizer::process()` against an EMPTY scene: a CanvasDelegate whose queries find
// nothing and whose mutations are recorded. So every stage runs (paths, the specialists, which
// find nothing to attach to, closed-shape detection, path extension, PathProcessor, PolyMatcher,
// the regularizer) and the recorded mutations are the result.
//
// `private` is defined as `public` (scratch build only) to read the intermediate fields the
// stage dump compares: isConvex_, needRegularization_, polyPointsUsedByMatcher_, the recognised
// paths and shapes.
// The standard headers come first so the define does not reach them.
#include <algorithm>
#include <climits>
#include <cmath>
#include <cstdio>
#include <functional>
#include <iostream>
#include <map>
#include <memory>
#include <set>
#include <sstream>
#include <string>
#include <utility>
#include <vector>
#define private public

#include "LineSetGenerators.h"
#include "base/Config.h"
#include "geometry/Shape.h"
#include "geometry/SimplePath.h"
#include "recognizer/CanvasDelegate.h"
#include "recognizer/Recognizer.h"
#undef private

using namespace lekhtest::linesets;
using avabodh::geometry::Point;
using avabodh::geometry::Rectangle;
using avabodh::geometry::SimplePath;
namespace rec = avabodh::recognizer;
namespace geo = avabodh::geometry;

namespace {

void num(double v) { std::printf("%.17g", v); }
void pt(const Point& p) { std::printf("["); num(p.x); std::printf(","); num(p.y); std::printf("]"); }
void pts(const std::vector<Point>& v) {
    std::printf("[");
    for (size_t i = 0; i < v.size(); i++) { std::printf("%s", i ? "," : ""); pt(v[i]); }
    std::printf("]");
}

void path(const SimplePath& sp) {
    std::printf("{\"closed\":%s,\"c\":[", sp.closed() ? "true" : "false");
    for (size_t i = 0; i < sp.size(); i++) {
        const auto& pc = sp.at(i);
        std::printf("%s", i ? "," : "");
        if (pc.isCurve) {
            std::printf("{\"curve\":true,\"p\":[");
            pt(pc.curve.point1); std::printf(","); pt(pc.curve.point2); std::printf(",");
            pt(pc.curve.point3); std::printf(","); pt(pc.curve.point4);
            std::printf("]}");
        } else {
            std::printf("{\"curve\":false,\"p\":[");
            pt(pc.segment.point1()); std::printf(","); pt(pc.segment.point2());
            std::printf("]}");
        }
    }
    std::printf("]}");
}

void shape(const geo::Shape::Ptr& s) {
    if (s->type() == geo::Shape::Type::Ellipse) {
        const auto& e = s->ellipse();
        std::printf("{\"kind\":\"ellipse\",\"center\":"); pt(e.center);
        std::printf(",\"width\":"); num(e.width);
        std::printf(",\"height\":"); num(e.height);
        std::printf(",\"rotation\":"); num(e.rotation);
        std::printf(",\"snap\":%s}", s->snap() ? "true" : "false");
    } else {
        std::printf("{\"kind\":\"path\",\"path\":"); path(s->path());
        std::printf(",\"snap\":%s}", s->snap() ? "true" : "false");
    }
}

// The empty scene: every query finds nothing; each mutation is printed as it is made.
class EmptyScene : public rec::CanvasDelegate {
public:
    int count = 0;
    void getExistingShapes(const std::vector<Rectangle>&, rec::FetchShapeType, const std::set<void*>&,
                           std::vector<rec::ExistingShape>*) override { }
    void getExistingShapes(const rec::GetExistingShapesArg&, std::vector<rec::ExistingShape2>*) override { }
    void convert(const std::vector<void*>&, geo::Shape::Ptr s, void**) override {
        record("convert", { s });
    }
    void getPathsNear(const geo::LineSegment&, std::vector<rec::ExistingShape>*) override { }
    void getShapesForConnection(const Point&, const Point&, const std::set<void*>&,
                                std::vector<rec::ObjectForConnection>*) override { }
    bool isAutoConnectionPresent(void*, void*, int) override { return false; }
    void addConnection(const rec::ConnectionDetail&, const std::set<void*>&) override { record("connect", {}); }
    void addShapes(const std::vector<geo::Shape::Ptr>& shapes, std::vector<void*>*) override { record("add", shapes); }
    void deleteShapes(const std::vector<void*>&) override { record("delete", {}); }
    void addDoubleLineArrow(const rec::DoubleLineArrowParam&) override { record("doubleLineArrow", {}); }
    void getArrowObjects(std::vector<rec::ArrowObjectInfo>*) override { }
    void changeArrow(const rec::ArrowOperationInfo&) override { record("arrow", {}); }
    void addUnrecognizedShape(const std::vector<Point>&) override { record("ink", {}); }
    bool placePath(SimplePath*) override { return false; }
    void getIntersections(void*, const geo::LineSegment&, std::vector<Point>*) override { }
    number_t currentStrokeWidth() override { return 2; }
    number_t getZoom() override { return 1; }
    void* getShapeForSelfLoop(const Point&, const Point&) override { return nullptr; }
    number_t distanceToOutline(void*, const Point&) override { return 1e9; }
    bool isInsideShape(void*, const Point&) override { return false; }
    Point projectToOutline(void*, const Point& p) override { return p; }
    bool isInsideTitle(void*, const Point&) override { return false; }
    bool isInsideOtherObject(void*, const Point&) override { return false; }
    Point shapeCentre(void*) override { return Point(); }
    Rectangle shapeBounds(void*) override { return Rectangle(); }

    // The shapes are printed to stdout directly, so the calls go out in order with them.
    void record(const char* op, const std::vector<geo::Shape::Ptr>& shapes) {
        std::printf("%s{\"op\":\"%s\",\"shapes\":[", count++ ? "," : "", op);
        for (size_t i = 0; i < shapes.size(); i++) { std::printf("%s", i ? "," : ""); shape(shapes[i]); }
        std::printf("]}");
    }
};

// An open stroke through the vertices, one line per segment.
LineSet openPolyline(const std::string& name, const std::vector<Point>& v) {
    StrokeBuilder b(name);
    b.start(v[0].x, v[0].y);
    for (size_t i = 1; i < v.size(); i++) b.segment(v[i].x, v[i].y);
    return b.take();
}

// k chords of the arc of radius r about c from angle a0 to a1 (radians, y down).
LineSet arc(const std::string& name, Point c, double r, double a0, double a1, int k, bool closeIt) {
    std::vector<Point> v;
    for (int i = 0; i <= k; i++) {
        const double a = a0 + (a1 - a0) * i / k;
        v.push_back(Point(c.x + r * std::cos(a), c.y + r * std::sin(a)));
    }
    if (closeIt) return closedPolygon(name, std::vector<Point>(v.begin(), v.end() - 1));
    return openPolyline(name, v);
}

std::vector<Point> regular(int n, Point c, double r, double rot) {
    std::vector<Point> v;
    for (int i = 0; i < n; i++) {
        const double a = rot + 2 * kPi * i / n;
        v.push_back(Point(c.x + r * std::cos(a), c.y + r * std::sin(a)));
    }
    return v;
}

bool firstCase = true;

void runCase(LineSet set) {
    rec::Recognizer r;
    EmptyScene scene;
    r.setCanvasDelegate(&scene);
    r.testSetLines(set.lines);
    std::printf("%s\n{\"name\":\"%s\",\"lines\":%zu,\"mutations\":[", firstCase ? "" : ",", set.name.c_str(),
                set.lines.size());
    firstCase = false;
    r.process();
    std::printf("],\"convex\":%s,\"needRegularization\":%s,\"matcherPoints\":",
                r.isConvex_ ? "true" : "false", r.needRegularization_ ? "true" : "false");
    pts(r.polyPointsUsedByMatcher_);
    std::printf(",\"paths\":[");
    for (size_t i = 0; i < r.recognizedPath_.size(); i++) { std::printf("%s", i ? "," : ""); path(r.recognizedPath_[i]); }
    std::printf("],\"shapes\":[");
    for (size_t i = 0; i < r.recognizedShapes_.size(); i++) { std::printf("%s", i ? "," : ""); shape(r.recognizedShapes_[i]); }
    std::printf("]}");
}

}  // namespace

int main() {
    std::printf("{\"number_t_bytes\":%zu,\"cases\":[", sizeof(number_t));
    // The C++ generator sets.
    runCase(rect());
    runCase(triangle());
    runCase(ellipse(8));
    runCase(ellipse(12));
    runCase(ellipse(16));
    runCase(rect_twice());
    runCase(spiral(10));
    runCase(spiral(15));
    runCase(overtrace(10));
    runCase(scribble(12, 1234));
    runCase(zigzag(6));
    runCase(zigzag(25));
    runCase(hatch(8));
    // Closed figures.
    runCase(closedPolygon("square", {Point(100, 100), Point(200, 100), Point(200, 200), Point(100, 200)}));
    runCase(closedPolygon("parallelogram", {Point(100, 100), Point(240, 100), Point(200, 180), Point(60, 180)}));
    runCase(closedPolygon("diamond", {Point(200, 100), Point(280, 180), Point(200, 260), Point(120, 180)}));
    runCase(closedPolygon("nearRect", {Point(101, 99), Point(243, 103), Point(240, 191), Point(98, 186)}));
    runCase(closedPolygon("pentagon", regular(5, Point(300, 300), 80, -kPi / 2)));
    runCase(closedPolygon("hexagon", regular(6, Point(300, 300), 80, 0)));
    runCase(closedPolygon("octagon", regular(8, Point(300, 300), 80, kPi / 8)));
    runCase(closedPolygon("tri2", {Point(100, 100), Point(260, 120), Point(150, 230)}));
    runCase(arc("circle10", Point(300, 300), 60, 0, 2 * kPi, 10, true));
    runCase(arc("smallCircle7", Point(300, 300), 18, 0, 2 * kPi, 7, true));
    // Open figures.
    runCase(openPolyline("line", {Point(100, 100), Point(260, 140)}));
    runCase(openPolyline("L", {Point(100, 100), Point(100, 220), Point(220, 220)}));
    runCase(openPolyline("U", {Point(100, 100), Point(100, 220), Point(220, 220), Point(220, 100)}));
    runCase(openPolyline("Z", {Point(100, 100), Point(220, 100), Point(100, 220), Point(220, 220)}));
    runCase(openPolyline("gapRect", {Point(110, 100), Point(220, 100), Point(220, 180), Point(100, 180), Point(100, 112)}));
    runCase(openPolyline("gapTriangle", {Point(100, 200), Point(160, 96), Point(220, 200), Point(112, 200)}));
    runCase(openPolyline("star5", {Point(100, 300), Point(200, 50), Point(300, 300), Point(60, 140), Point(340, 140), Point(100, 300)}));
    runCase(openPolyline("chevron", {Point(100, 100), Point(180, 160), Point(100, 220)}));
    runCase(arc("arc6", Point(300, 300), 100, kPi, 2 * kPi, 6, false));
    runCase(arc("arc12", Point(300, 300), 100, kPi, 1.8 * kPi, 12, false));
    runCase(arc("arc270", Point(300, 300), 80, 0, 1.5 * kPi, 12, false));
    runCase(arc("nearlyClosedArc", Point(300, 300), 80, 0.1, 2 * kPi - 0.15, 14, false));
    std::printf("\n]}\n");
    return 0;
}
