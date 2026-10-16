// Capture harness for the ordered CxPoly golden (spec 07 §7.3, AC-REC-07). Built and run by
// regen.mjs; prints JSON on stdout. For each synthetic line set (LineSetGenerators.h) and each
// search mode it records PolyColl::process()'s polys IN ORDER (line ids in part order, part ends,
// closed after features, the features), then PolyColl::splitExtensions()'s polys.
#include <cstdio>
#include <string>
#include <vector>

#include "LineSetGenerators.h"
#include "base/Config.h"
#include "recognizer/CxPoly.h"
#include "recognizer/LineColl.h"
#include "recognizer/PolyColl.h"

using namespace lekhtest::linesets;
using avabodh::recognizer::CxPoly;
using avabodh::recognizer::LineColl;
using avabodh::recognizer::PolyColl;

namespace {

void num(double v) { std::printf("%.17g", v); }

void dumpPoly(CxPoly::Ptr p, bool withFeatures, bool withParts) {
    std::printf("{\"ids\":[");
    for (size_t i = 0; i < p->lines().size(); i++) std::printf("%s%d", i ? "," : "", p->lines()[i].line->id());
    std::printf("]");
    if (withParts) {
    std::printf(",\"parts\":[");
    for (size_t i = 0; i < p->lines().size(); i++) {
        const auto& lp = p->lines()[i];
        std::printf("%s[", i ? "," : "");
        num(lp.start.x); std::printf(","); num(lp.start.y); std::printf(",");
        num(lp.end.x); std::printf(","); num(lp.end.y); std::printf("]");
    }
    std::printf("]");
    }
    std::printf(",\"turn\":%d", (int)p->turnDir());
    if (withFeatures) {
        auto f = p->features();
        std::printf(",\"closed\":%s,\"almostClosed\":%s", p->closed() ? "true" : "false",
                    p->almostClosed() ? "true" : "false");
        std::printf(",\"perimeter\":"); num(f->perimeter);
        std::printf(",\"width\":"); num(f->width);
        std::printf(",\"height\":"); num(f->height);
        std::printf(",\"totalAngle\":"); num(f->totalAngle);
        std::printf(",\"segments\":%zu,\"mainAngles\":[", f->segments.size());
        for (size_t i = 0; i < f->mainAngles.size(); i++) std::printf("%s%d", i ? "," : "", f->mainAngles[i].segId);
        std::printf("],\"smoothness\":"); num(p->smoothness());
        std::printf(",\"smoothness2\":"); num(p->smoothness2());
    } else {
        std::printf(",\"closed\":%s", p->closed() ? "true" : "false");
    }
    std::printf("}");
}

bool firstCase = true;

void runCase(const std::string& name, const LineSet& set, bool inOrder) {
    LineColl lc;
    lc.addLines(set.lines);
    lc.setLineSearchInOrder(inOrder);
    PolyColl pc;
    pc.setLines(&lc);
    pc.process();
    std::printf("%s\n{\"name\":\"%s\",\"mode\":\"%s\",\"lines\":%zu,\"budgetExceeded\":%s,\"polys\":[",
                firstCase ? "" : ",", name.c_str(), inOrder ? "inorder" : "nearby", set.lines.size(),
                pc.budgetExceeded() ? "true" : "false");
    firstCase = false;
    const bool detail = pc.polys().size() <= 300;
    // Raw order first (closed as the search left it), then the features.
    for (size_t i = 0; i < pc.polys().size(); i++) {
        std::printf("%s", i ? "," : "");
        dumpPoly(pc.polys()[i], false, false);
    }
    std::printf("],\"featured\":[");
    if (!pc.budgetExceeded() && detail) {
        for (size_t i = 0; i < pc.polys().size(); i++) {
            std::printf("%s", i ? "," : "");
            dumpPoly(pc.polys()[i], true, true);
        }
    }
    std::printf("],\"split\":[");
    if (!pc.budgetExceeded()) {
        pc.splitExtensions();
        for (size_t i = 0; i < pc.polys().size(); i++) {
            std::printf("%s{\"id\":%d,\"poly\":", i ? "," : "", pc.polys()[i]->id());
            dumpPoly(pc.polys()[i], false, detail);
            std::printf("}");
        }
    }
    std::printf("]}");
}

}  // namespace

int main() {
    std::printf("{\"number_t_bytes\":%zu,\"cases\":[", sizeof(number_t));
    struct C { std::string name; LineSet set; bool nearby; };
    std::vector<C> cases;
    cases.push_back({"zigzag25", zigzag(25), true});
    cases.push_back({"hatch25", hatch(25), true});
    cases.push_back({"spiral10", spiral(10), true});
    cases.push_back({"spiral15", spiral(15), true});
    cases.push_back({"overtrace10", overtrace(10), true});
    cases.push_back({"overtrace15", overtrace(15), false});
    cases.push_back({"scribble12", scribble(12, 1234), true});
    cases.push_back({"rect", rect(), true});
    cases.push_back({"triangle", triangle(), true});
    cases.push_back({"ellipse8", ellipse(8), true});
    cases.push_back({"ellipse12", ellipse(12), true});
    cases.push_back({"rect_twice", rect_twice(), true});
    cases.push_back({"overtrace16", overtrace(16), true});
    cases.push_back({"scribble16_98765", scribble(16, 98765), true});
    cases.push_back({"spiral16", spiral(16), true});
    for (auto& c : cases) {
        runCase(c.name, c.set, true);
        if (c.nearby) runCase(c.name, c.set, false);
    }
    std::printf("\n]}\n");
    return 0;
}
