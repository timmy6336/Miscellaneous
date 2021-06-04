<?php require_once('config.php'); ?>

<?php
/*
Name: Gregory Hablutzel, Timmy Roma, Ella Gainey
Class: TCSS445-DB Fall-20 Al-Masri
Assignment: Group Assignment Phase 3
Description:
 - This PHP file contains the "Sign" php logic page for Kanto Spirit.
 - Takes in a Sign by the user, and outputs a table containing the: Name, Type, Ability, Generation, and Image of pokemon that match the query
 */
?>


<!DOCTYPE html>
<html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Kanto Spirit</title>
        <link rel="icon" href="/groupAssignment/images/KantoSpirit2.png">
        <link rel="stylesheet" href="https://bootswatch.com/4/superhero/bootstrap.min.css">

        <style>
            /* styling for images*/
            img {
                display: block;
                margin-left: auto;
                margin-right: auto;
            }

            /* styling for button div*/
            .container {
                height: 200px;
                position: relative;
            }

            /* Styling for images of queries above buttons (General and Visual queries)*/
            .center {
                margin: 0;
                position: absolute;
                top: 50%;
                left: 50%;
                -ms-transform: translate(-50%, -50%);
                transform: translate(-50%, -50%);
            }
        </style>
    </head>
    <body>
        <!-- START -- Add HTML code for the top menu section (navigation bar) -->
        <nav class="navbar navbar-expand-lg navbar-dark bg-dark">
            <style>
                /* Add Local Pokemon Fonts */

                /* https://www.fontspace.com/pocket-monk-font-f23540 */
                @font-face {
                    font-family: "PocketMonk";
                    src: url("/groupAssignment/fonts/PocketMonk-15ze.ttf");
                }
                /* https://www.fontspace.com/eviolite-font-f32546 */
                @font-face {
                    font-family: "EvioliteRegular";
                    src: url("/groupAssignment/fonts/EvioliteRegular-ZjA8.ttf");
                }
                /* This one doesn't seem to work*/
                @font-face {
                    font-family: "LMSPokedex";
                    src: url("/groupAssignment/fonts/LmsPokedex-XEja.ttf");
                }
                /* https://www.fontspace.com/pokemon-gb-font-f9621 */
                @font-face {
                    font-family: "PokemonGB";
                    src: url("/groupAssignment/fonts/PokemonGb-RAeo.ttf");
                }
                /* https://www.fontspace.com/pokemon-hollow-font-f13845 */
                @font-face {
                    font-family: "PokemonHollow";
                    src: url("/groupAssignment/fonts/PokemonHollowNormal-pyPZ.ttf");
                }
                /* https://www.fontspace.com/pokemon-solid-font-f13844 */
                @font-face {
                    font-family: "PokemonSolid";
                    src: url("/groupAssignment/fonts/PokemonSolidNormal-xyWR.ttf");
                }
                /* https://www.fontspace.com/pokemon-solid-font-f13844 */
                @font-face {
                    font-family: "Hisel";
                    src: url("/groupAssignment/fonts/HiselRegular-9qyj.ttf");
                }
                /* NavBar "KantoSpirit" font*/
                .navbar-brand {
                    font-family: PocketMonk;
                }
                /* NavBar Page Selection Header Font (Home, Spirit Pokemon Queries,...,About)*/
                .nav-item {
                    font-family: Hisel;
                    font-size: 180%;
                }

                /* styling for button div*/
                .container {
                    font-family: Hisel;
                    font-size: 200%;
                }

                /* make table output black text on light gray background, instead of the stock light gray text on light gray background*/
                .rowOutput p{
                    color: black;
                }


            </style>
            <a class="navbar-brand" href="#">Kanto Spirit</a>
            <button class="navbar-toggler" type="button" data-toggle="collapse" data-target="#navbarColor02" aria-
                    controls="navbarColor02" aria-expanded="false" aria-label="Toggle navigation">
                <span class="navbar-toggler-icon"></span>
            </button>
            <div class="collapse navbar-collapse" id="navbarColor02">
                <ul class="navbar-nav mr-auto">
                    <li class="nav-item">
                        <a class="nav-link active" href="index.php">Home
                            <span class="sr-only">(current)</span>
                        </a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" href="SpiritPokemonQueries.php">Spirit Pokemon Queries</a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" href="GeneralQueries.php">General Queries</a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" href="VisualQueries.php">Visual Queries</a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" href="about.php">About</a>
                    </li>
                </ul>
            </div>
        </nav>
        <div class="jumbotron">
            <?php
            require_once('config.php');
            ?>

            <!DOCTYPE html>
            <html>
                <head>
                    <style>
                        table {
                            font-family: arial, sans-serif;
                            border-collapse: collapse;
                            width: 100%;
                        }
                        td, th {
                            border: 1px solid #dddddd;
                            text-align: left;
                            padding: 8px;
                        }
                        tr:nth-child(even) {
                            background-color: #dddddd;
                        }
                    </style>
                </head>
                <body>
                    <?php
                    $last_name = $_GET['last_name'];
                    $last_name2 = $_GET['last_name2'];

                    ?>
                    <h1> Your Spirit Pokemon:</h1>
                    <table>
                        <tr>
                            <th>Name</th>
                            <th>Type</th>
                            <th>Ability</th>
                            <th>Generation</th>
                            <th>Image</th>
                        </tr>
                        <?php
                            $connection = mysqli_connect(DBHOST, DBUSER, DBPASS, DBNAME);
                        if ( mysqli_connect_errno() )
                        {
                            die( mysqli_connect_error() );
                        }

                        /* Takes a zodic and emotion from user, and output as a table the following attributes of the matching PokeMon:
                            - Name, Type, Ability, Generation, Image*/
                        $sql = "SELECT *
                                FROM POKEMON, SPIRIT
                                WHERE SPIRIT.ZODIAC = '{$last_name}'
                                AND SPIRIT.EMOTION = '{$last_name2}'
                                AND POKEMON.SpiritNo = SPIRIT.SpiritNo;";

                        /* Store name of Pokemon, to be used in other query*/
                        $pnameVal='';
                        /*$pnameArray=array();*/
                        if ($result = mysqli_query($connection, $sql))
                        {
                            while($row = mysqli_fetch_assoc($result))
                            {
                                /* Store name of Pokemon, to be used in other query*/
                                $pnameVal=$row['Pname'];
                                /*array_push($pnameArray,$pnameVal);*/


                                




                        ?>
                        <p><?php echo $row['ImagePath'] ?>

                        </p>
                        <tr>
                            <td class="rowOutput"><p><?php echo $row['Pname'] ?></p></td>
                            <td class="rowOutput"><p><?php echo $row['Ptype'] ?></p></td>
                            <td class="rowOutput"><p><?php echo $row['Ability'] ?></p></td>
                            <td class="rowOutput"><p><?php echo $row['GenNum'] ?></p></td>

                            <?php

                            /* Takes a Pokemon name, and outputs its image to the table. */
                                $sql4 = "SELECT ImagePath
                                FROM VISUALS
                                WHERE VISUALS.Pname = '{$pnameVal}'";

                                if ($result4 = mysqli_query($connection, $sql4))
                                {
                                    while($row4 = mysqli_fetch_assoc($result4))
                                    {
                            ?>
                            <td><img src="<?php echo $row4['ImagePath']; ?>" height=100 width=100//></td>

                            <?php
                                    }
                                }


                            ?>
                        </tr>
                        <?php
                            }
                        }
                        ?>
                    </table>
                    <img src="<?php echo $row['ImagePath']; ?>" width = 300px/>


                    <?php
                    /*echo $pnameVal;*/

                    /* Takes a Pokemon name, and outputs a larger image of it below the table. */
                    $sql2 = "SELECT ImagePath
                                FROM VISUALS
                                WHERE VISUALS.Pname = '{$pnameVal}'";

                    if ($result2 = mysqli_query($connection, $sql2))
                    {
                        while($row2 = mysqli_fetch_assoc($result2))
                        {
                            /*echo $row2['ImagePath'];*/
                            ?>
                    <img src="<?php echo $row2['ImagePath']; ?>" width = 300px/>

                    <?php
                        }
                    }

                    /* Takes a Pokemon name, and outputs its description below the larger image that is below the table. */
                    $sql3 = "SELECT Description
                                FROM POKEMON
                                WHERE POKEMON.Pname = '{$pnameVal}'";

                    if ($result3 = mysqli_query($connection, $sql3))
                    {
                        while($row3 = mysqli_fetch_assoc($result3))
                        {
                            ?>

                    <div class="pokemonDescription">
                        <p class="pokemonDescriptionText"> <?php echo $row3['Description']; ?>  </p>
                    </div>

                           <?php
                        }
                    }

                    mysqli_free_result($result);
                    mysqli_free_result($result2);
                    mysqli_free_result($result3);
                    mysqli_free_result($result4);
                    mysqli_close($connection);
                    ?>
                </body>
            </html>
        </div>
    </body>
</html>