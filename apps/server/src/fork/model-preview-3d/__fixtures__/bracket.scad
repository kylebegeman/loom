/* [Bracket] */
// Outside width in mm
width = 40; // [20:1:100]
// Wall thickness in mm
wall = 3; // [1:0.5:8]
// Mounting hole diameter
hole = 4; // [3:Small, 4:Medium, 6:Large]
// Show the mounting holes
holes = true;
color_name = "orange"; // [orange, blue, green]
position = [0,0,0];
include <profile.scad>
translate(position) color(color_name) difference() {
  union() {
    cube([width,20,wall]);
    cube([width,wall,20]);
  }
  if (holes) for (x=[width/4,3*width/4]) translate([x,10,-1]) cylinder(d=hole,h=wall+2,$fn=24);
}
echo("Bracket width",width,"wall",wall);
