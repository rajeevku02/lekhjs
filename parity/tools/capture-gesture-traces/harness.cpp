// AC-UI-03 oracle: replays the synthetic gesture traces through the C++ GestureRecognizer (with
// its scale / scroll / rotate recognisers) on a fake clock and prints every listener call as JSON
// ({call, t, x, y, n, value, m}). Built and run by regen.mjs (never by the product), against a
// scratch copy of lekh/event with a stub lekh/Platform.h that supplies only the timers.
//
// Input (stdin, one item per line, written by regen.mjs from traces.json):
//   trace <name> <canDoubleClick> <canLongPress> <canRotate> <drawOnly> <longPressMs>
//   ev <t> <n> then n × (<id> <x> <y> <state> <type> <button>)
//   adv <ms>
//   reset <t>
//   end
#include <cstdio>
#include <cstring>
#include <functional>
#include <iostream>
#include <map>
#include <string>
#include <vector>

#include "lekh/Platform.h"
#include "lekh/event/GestureRecognizer.h"

using namespace avabodh::lekh;
using namespace avabodh::lekh::event;
using avabodh::geometry::Point;

namespace {

double now = 0;
long nextId = 1;
std::multimap<double, std::pair<long, std::function<void()>>> timers;

class StubPlatform : public Platform {
public:
    long setTimer(long ms, std::function<void()> cb) override {
        long id = nextId++;
        timers.insert({now + ms, {id, cb}});
        return id;
    }
    void clearTimer(long id) override {
        for (auto it = timers.begin(); it != timers.end(); ++it) {
            if (it->second.first == id) {
                timers.erase(it);
                return;
            }
        }
    }
};

void runUntil(double t) {
    for (;;) {
        auto it = timers.begin();
        if (it == timers.end() || it->first > t) break;
        double at = it->first;
        auto fn = it->second.second;
        timers.erase(it);
        now = at;
        fn();
    }
    now = t;
}

bool firstCall = true;

const char* mv(PointerMovement m) {
    switch (m) {
        case PointerMovement::Start: return "start";
        case PointerMovement::Move: return "move";
        case PointerMovement::End: return "end";
    }
    return "?";
}

void out(const char* call, const Point& at, PointerEvent* ev, double value, const char* m) {
    std::printf("%s{\"call\":\"%s\",\"t\":%.17g,\"x\":%.17g,\"y\":%.17g,\"n\":%d,\"value\":%.17g,\"m\":\"%s\"}",
                firstCall ? "" : ",", call, now, (double)at.x, (double)at.y, ev != nullptr ? (int)ev->points().size() : -1,
                value, m);
    firstCall = false;
}

class Recorder : public GestureListener {
public:
    bool canDouble = false, canLong = false, canRotate = false, drawOnly = false;
    double longPressMs = 0;

    EventCheckResult canDoAt(EventName name, const Point& at, PointerEvent* ev) override {
        EventCheckResult r;
        if (name == EventName::DoubleClick) r.canHandle = canDouble;
        if (name == EventName::LongPress) { r.canHandle = canLong; r.param = longPressMs; }
        if (name == EventName::Rotate) r.canHandle = canRotate;
        const char* n = name == EventName::DoubleClick ? "canDoubleClick" : name == EventName::LongPress ? "canLongPress" : "canRotate";
        out(n, at, ev, r.canHandle ? 1 : 0, "");
        return r;
    }
    bool isDrawOnlyMode(const Point&) override { return drawOnly; }
    bool onDown(const Point& at, PointerEvent* ev) override { out("down", at, ev, 0, ""); return true; }
    bool onUp(const Point& at, PointerEvent* ev) override { out("up", at, ev, 0, ""); return true; }
    bool onClick(const Point& at, PointerEvent* ev) override { out("click", at, ev, 0, ""); return true; }
    bool onDoubleClick(const Point& at, PointerEvent* ev) override { out("doubleClick", at, ev, 0, ""); return true; }
    bool onPan(const Point& at, PointerEvent* ev, PointerMovement m) override { out("pan", at, ev, 0, mv(m)); return true; }
    bool onScale(const Point& at, PointerEvent* ev, number_t v, PointerMovement m) override { out("scale", at, ev, v, mv(m)); return true; }
    bool onRotate(const Point& at, PointerEvent* ev, number_t v, PointerMovement m) override { out("rotate", at, ev, v, mv(m)); return true; }
    bool onLongPress(const Point& at, PointerEvent* ev, PointerMovement m) override { out("longPress", at, ev, 0, mv(m)); return true; }
    void cancelDrag() override { out("cancelDrag", Point(), nullptr, 0, ""); }
};

EventPointState stateOf(const std::string& s) {
    if (s == "down") return EventPointState::Down;
    if (s == "move") return EventPointState::Move;
    return EventPointState::Up;
}

PointerType typeOf(const std::string& s) {
    if (s == "mouse") return PointerType::Mouse;
    if (s == "pen") return PointerType::Pen;
    return PointerType::Finger;
}

MouseButton buttonOf(const std::string& s) {
    if (s == "left") return MouseButton::Left;
    if (s == "right") return MouseButton::Right;
    return MouseButton::None;
}

}

namespace avabodh { namespace lekh {
Platform* Platform::currentPlatform = nullptr;
}}

int main() {
    StubPlatform platform;
    Platform::currentPlatform = &platform;
    std::string word;
    bool firstTrace = true;
    std::printf("{\"traces\":[");
    while (std::cin >> word) {
        if (word != "trace") continue;
        std::string name;
        Recorder rec;
        int cd, cl, cr, dro;
        std::cin >> name >> cd >> cl >> cr >> dro >> rec.longPressMs;
        rec.canDouble = cd != 0; rec.canLong = cl != 0; rec.canRotate = cr != 0; rec.drawOnly = dro != 0;
        now = 0;
        timers.clear();
        GestureRecognizer gr(&rec);
        std::printf("%s{\"name\":\"%s\",\"calls\":[", firstTrace ? "" : ",", name.c_str());
        firstTrace = false;
        firstCall = true;
        for (;;) {
            std::cin >> word;
            if (word == "end") break;
            if (word == "adv") {
                double ms; std::cin >> ms;
                runUntil(now + ms);
            } else if (word == "reset") {
                double t; std::cin >> t;
                runUntil(t);
                gr.reset();
            } else if (word == "ev") {
                double t; int n; std::cin >> t >> n;
                runUntil(t);
                PointerEvent ev;
                std::vector<EventPoint> pts;
                for (int i = 0; i < n; i++) {
                    long id; double x, y; std::string st, tp, bt;
                    std::cin >> id >> x >> y >> st >> tp >> bt;
                    EventPoint p;
                    p.x = x; p.y = y; p.pointerId = id; p.state = stateOf(st);
                    p.pressure = 0; p.altitude = 0; p.azimuth = 0; p.timestamp = t;
                    p.pointerType = typeOf(tp); p.button = buttonOf(bt);
                    pts.push_back(p);
                }
                ev.setPoints(pts);
                gr.onPointerEvent(&ev);
            }
        }
        timers.clear();
        std::printf("]}");
    }
    std::printf("]}\n");
    return 0;
}
