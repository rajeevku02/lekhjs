// AC-UI-22 oracle: for every board of the core fixture set and every selectable target on its
// active page (each top-level object, and the multi-selection of all of them when it has two or
// more movable objects), the C++ SelectionMenuWidget's items in registration order, each with
// `shown` (isVisible) and `collapsed` (isCollapsedAlways). Written as JSON to $LEKH_CAPTURE_OUT.
//
// Built and run by regen.mjs (never by the product): compiled with the lekhcore test tier's
// flags and linked against its core and support objects, with the test Platform environment.
// `allMenuItems_` is private; this unit alone sees it public. Each target is set as the selection
// widget's target (the clipboard checks read it), then cleared.
#include <cstdio>
#include <cstdlib>
#include <cxxabi.h>
#include <fstream>
#include <functional>
#include <map>
#include <memory>
#include <set>
#include <sstream>
#include <string>
#include <typeinfo>
#include <vector>

#include <gtest/gtest.h>

#include "TestEnvironment.h"
#include "Fixtures.h"
#include "lekh/LekhGlobal.h"
#include "lekh/Platform.h"
#include "lekh/document/DocManager.h"
#include "lekh/document/LekhDocument.h"
#include "lekh/document/ObjectStore.h"
#include "lekh/document/Page.h"
#include "lekh/connection/ConnectionObject.h"
#include "lekh/object/GroupObject.h"
#include "lekh/object/TemplatedObject.h"
#include "lekh/object/widget/selection/MultiSelectedObjects.h"

#define private public
#define protected public
#include "lekh/object/widget/selection/SelectionMenuWidget.h"
#undef protected
#undef private
#include "lekh/app/LekhCore.h"
#include "lekh/object/widget/MiddleWidget.h"

using namespace avabodh::lekh;
using avabodh::geometry::Rectangle;
using avabodh::lekh::object::widget::selection::MultiSelectedObjects;
using avabodh::lekh::object::widget::selection::SelectionMenuItem;
using avabodh::lekh::object::widget::selection::SelectionMenuWidget;

namespace {

std::string className(const SelectionMenuItem& item)
{
    int status = 0;
    char* d = abi::__cxa_demangle(typeid(item).name(), nullptr, nullptr, &status);
    std::string s = d != nullptr ? d : typeid(item).name();
    std::free(d);
    auto p = s.rfind("::");
    return p == std::string::npos ? s : s.substr(p + 2);
}

std::string esc(const std::string& s)
{
    std::string o;
    for (char c: s) {
        if (c == '"' || c == '\\') o += '\\';
        o += c;
    }
    return o;
}

std::string kindOf(LekhObject::Ptr t)
{
    if (t.is_instance_of<MultiSelectedObjects>()) return "multi";
    if (t.is_instance_of<GroupObject>()) return "group";
    if (t.is_instance_of<connection::ConnectionObject>()) return "connector";
    if (t.is_instance_of<TemplatedObject>()) return "templated";
    return "other";
}

void dumpTarget(std::ostringstream& out, SelectionMenuWidget& menu, LekhObject::Ptr target, const std::string& key, bool& first)
{
    // The menu's items ask the clipboard, which reads the selection widget's target (C++
    // `Clipboard::selectedObject`): the target is the selection, as when the menu shows.
    auto* sel = avabodh::lekh::app::LekhCore::instance()->middleWidget()->selectionWidget().get();
    sel->update(target);
    menu.update(target);
    out << (first ? "" : ",") << "{\"target\":\"" << esc(key) << "\",\"kind\":\"" << kindOf(target) << "\",\"items\":[";
    first = false;
    bool f2 = true;
    for (auto& item: menu.allMenuItems_) {
        std::string cls = className(*item);
        out << (f2 ? "" : ",") << "{\"cls\":\"" << cls << "\",\"shown\":" << (item->isVisible() ? "true" : "false")
            << ",\"collapsed\":" << (item->isCollapsedAlways() ? "true" : "false") << "}";
        f2 = false;
    }
    out << "]}";
    menu.update(LekhObject::Ptr());
    sel->update(LekhObject::Ptr());
}

}

TEST(SelectionActionsCapture, Dump)
{
    const char* outPath = std::getenv("LEKH_CAPTURE_OUT");
    const char* listPath = std::getenv("LEKH_CAPTURE_BOARDS");
    ASSERT_NE(outPath, nullptr);
    ASSERT_NE(listPath, nullptr);
    std::ifstream list(listPath);
    std::string rel;
    std::ostringstream out;
    out << "{\"boards\":[";
    bool firstBoard = true;
    SelectionMenuWidget menu(nullptr);
    while (std::getline(list, rel)) {
        if (rel.empty()) continue;
        std::string text;
        ASSERT_TRUE(lekhtest::readTextFile(lekhtest::fixturePath(rel), &text)) << rel;
        std::string message;
        LekhDocument::Ptr doc = DocManager::instance.load(text, &message);
        out << (firstBoard ? "" : ",") << "{\"board\":\"" << esc(rel) << "\",\"loaded\":" << (doc != nullptr ? "true" : "false")
            << ",\"targets\":[";
        firstBoard = false;
        if (doc != nullptr) {
            LekhGlobal::instance().setDocument(doc);
            NoOpPlatform nop;
            auto* objs = doc->activePage()->objectStore()->getObjects();
            for (auto& o: *objs) o->draw(&nop, Rectangle());
            bool first = true;
            std::vector<LekhObject::Ptr> all(objs->begin(), objs->end());
            for (size_t i = 0; i < all.size(); i++) dumpTarget(out, menu, all[i], std::to_string(i), first);
            MultiSelectedObjects::Ptr multi(new MultiSelectedObjects);
            multi->addObjects(all);
            if (multi->movableObjects().size() > 1) dumpTarget(out, menu, multi, "multi", first);
            multi->clearObjects();
            LekhGlobal::instance().setDocument(LekhDocument::Ptr());
        }
        out << "]}";
    }
    out << "]}\n";
    std::ofstream f(outPath);
    f << out.str();
}

int main(int argc, char** argv)
{
    ::testing::InitGoogleTest(&argc, argv);
    ::testing::AddGlobalTestEnvironment(new lekhtest::TestEnvironment());
    return RUN_ALL_TESTS();
}
