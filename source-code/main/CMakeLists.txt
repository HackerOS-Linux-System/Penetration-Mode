cmake_minimum_required(VERSION 3.16)

project(PenetrationMode LANGUAGES CXX)

# ================== USTAWIENIA PROJEKTU ==================
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Automatyczna obsługa plików Qt (MOC, RCC, UIC)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)
set(CMAKE_AUTOUIC ON)

# ================== QT6 ==================
# Szukamy Qt6 w systemie
find_package(Qt6 REQUIRED COMPONENTS
    Core
    Gui
    Widgets
)

# ================== EXECUTABLE ==================
# Używamy pełnej ścieżki do źródła, aby uniknąć błędów w folderze build
qt_add_executable(penetration-mode
    "${CMAKE_CURRENT_SOURCE_DIR}/src/main.cpp"
)

# ================== LINKOWANIE ==================
target_link_libraries(penetration-mode PRIVATE
    Qt6::Core
    Qt6::Gui
    Qt6::Widgets
)

# ================== FLAGI KOMPILACJI ==================
if(CMAKE_BUILD_TYPE STREQUAL "Release")
    target_compile_options(penetration-mode PRIVATE -O3 -march=native)
else()
    target_compile_options(penetration-mode PRIVATE -g -Wall)
endif()

# ================== INSTALACJA ==================
install(TARGETS penetration-mode
    RUNTIME DESTINATION /usr/lib/HackerOS/Penetration-Mode
)

# ================== DIAGNOSTYKA ==================
message(STATUS "--------------------------------------------")
message(STATUS "PROJEKT: Penetration Mode")
message(STATUS "WERSJA QT: ${Qt6_VERSION}")
message(STATUS "ZRODLO: ${CMAKE_CURRENT_SOURCE_DIR}/src/main.cpp")
message(STATUS "--------------------------------------------")
